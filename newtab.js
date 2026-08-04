const DB_NAME = "work-clipboard-db";
const DB_VERSION = 1;
const STORE = "items";
const DELETED_IDS_KEY = "work-clipboard-deleted-companion-ids";
const LIMIT_REMINDER_KEY = "parkit-limit-reminder-dismissed-count";
const ITEM_LIMIT = 20;

const state = {
  items: [],
  filter: "active",
  query: "",
  companionIds: new Set(),
  deletedCompanionIds: loadDeletedCompanionIds()
};

const els = {
  todayLabel: document.querySelector("#todayLabel"),
  totalCount: document.querySelector("#totalCount"),
  fileCount: document.querySelector("#fileCount"),
  stashCount: document.querySelector("#stashCount"),
  companionStatus: document.querySelector("#companionStatus"),
  filters: document.querySelectorAll(".filter"),
  cleanupButton: document.querySelector("#cleanupButton"),
  searchInput: document.querySelector("#searchInput"),
  fileInput: document.querySelector("#fileInput"),
  fileButton: document.querySelector("#fileButton"),
  pasteButton: document.querySelector("#pasteButton"),
  dropZone: document.querySelector("#dropZone"),
  textInput: document.querySelector("#textInput"),
  tagInput: document.querySelector("#tagInput"),
  saveTextButton: document.querySelector("#saveTextButton"),
  exportVisibleButton: document.querySelector("#exportVisibleButton"),
  viewTitle: document.querySelector("#viewTitle"),
  viewHint: document.querySelector("#viewHint"),
  limitReminder: document.querySelector("#limitReminder"),
  limitReminderText: document.querySelector("#limitReminderText"),
  limitCleanupButton: document.querySelector("#limitCleanupButton"),
  limitDismissButton: document.querySelector("#limitDismissButton"),
  itemsList: document.querySelector("#itemsList"),
  template: document.querySelector("#itemTemplate"),
  toast: document.querySelector("#toast"),
  confirmModal: document.querySelector("#confirmModal"),
  confirmText: document.querySelector("#confirmText"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  celebrationLayer: document.querySelector("#celebrationLayer")
};

let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("status", "status");
      store.createIndex("kind", "kind");
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function tx(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    const result = callback(store);

    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getAllItems() {
  return tx("readonly", (store) => {
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  });
}

async function putItem(item) {
  return tx("readwrite", (store) => store.put(item));
}

async function deleteItem(id) {
  return tx("readwrite", (store) => store.delete(id));
}

function loadDeletedCompanionIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function rememberDeletedCompanionId(id) {
  if (!id?.startsWith("win-")) return;

  state.deletedCompanionIds.add(id);
  const deletedIds = [...state.deletedCompanionIds].slice(-1000);
  localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(deletedIds));
  chrome.storage.local.set({ [DELETED_IDS_KEY]: deletedIds }).catch(() => {});
}

function dismissedLimitCount() {
  return Number(localStorage.getItem(LIMIT_REMINDER_KEY) || 0);
}

function pendingItemCount() {
  return state.items.filter((item) => item.status === "active").length;
}

function signalItemsChanged() {
  chrome.runtime.sendMessage({ type: "ITEMS_CHANGED" }).catch(() => {});
}

function syncDeletedCompanionIdsToStorage() {
  const deletedIds = [...state.deletedCompanionIds].slice(-1000);
  chrome.storage.local.set({ [DELETED_IDS_KEY]: deletedIds }).catch(() => {});
}

function makeId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function textContentKey(text) {
  const normalized = normalizeText(text);
  return normalized ? `text:${normalized.toLowerCase()}` : "";
}

function textNearDuplicateKey(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return "";

  return `text-near:${normalized.slice(0, 120)}`;
}

function duplicateQuality(item) {
  if (item.sourceUrl) return 4;
  if (item.id?.startsWith("web-text-")) return 3;
  if (item.id?.startsWith("win-text-")) return 2;
  return 1;
}

async function removeDuplicateTextItems(items) {
  const groups = new Map();

  for (const item of items) {
    if (item.kind !== "text") continue;

    const key = textNearDuplicateKey(item.text);
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, []);
    }

    groups.get(key).push(item);
  }

  const duplicateIds = [];

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const [keep, ...duplicates] = group.sort((a, b) => {
      const qualityDelta = duplicateQuality(b) - duplicateQuality(a);
      return qualityDelta || b.createdAt - a.createdAt;
    });

    for (const item of duplicates) {
      duplicateIds.push(item.id);
      rememberDeletedCompanionId(item.id);
    }
  }

  for (const id of duplicateIds) {
    await deleteItem(id);
  }

  return duplicateIds.length > 0;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function tagsFromInput() {
  return els.tagInput.value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(tags) {
  return [...new Set((tags || []).map((tag) => String(tag).trim()).filter(Boolean))];
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1800);
}

function bytesToLabel(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function sessionKey(value) {
  const date = new Date(value);
  date.setMinutes(Math.floor(date.getMinutes() / 15) * 15, 0, 0);
  return date.getTime();
}

function sessionLabel(value) {
  const start = new Date(Number(value));
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  });
  return `${formatter.format(start)} - ${formatter.format(end)} 临泊内容`;
}

function firstUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s"'<>]+/i);
  return match ? match[0] : "";
}

function parseUrlInfo(text) {
  const rawUrl = firstUrl(text);
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "");
    const isYouTube = /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(host);
    const time = url.searchParams.get("t") || "";
    return {
      url: rawUrl,
      host,
      isYouTube,
      time,
      label: isYouTube ? "YouTube 视频" : host.includes("github.com") ? "GitHub 链接" : "网页链接"
    };
  } catch {
    return null;
  }
}

function formatYouTubeTime(value) {
  if (!value) return "";
  const compact = String(value).match(/^(\d+)s?$/);
  const seconds = compact ? Number(compact[1]) : 0;
  if (!seconds) return value;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function pathLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[a-zA-Z]:\\/.test(line) || /^\\\\/.test(line));
}

function filePathInfo(text) {
  const paths = pathLines(text);
  if (!paths.length) return null;

  const first = paths[0];
  const parts = first.split(/[\\\/]/).filter(Boolean);
  const fileName = parts.at(-1) || first;
  const folder = parts.slice(0, -1).join("\\");
  const extension = (fileName.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
  const typeMap = {
    png: "图片",
    jpg: "图片",
    jpeg: "图片",
    gif: "图片",
    webp: "图片",
    pdf: "PDF",
    doc: "Word",
    docx: "Word",
    xls: "Excel",
    xlsx: "Excel",
    zip: "压缩包",
    rar: "压缩包",
    js: "代码",
    html: "代码",
    css: "代码",
    ps1: "脚本"
  };

  return {
    fileName,
    folder,
    count: paths.length,
    extension,
    type: typeMap[extension] || (extension ? `${extension.toUpperCase()} 文件` : "文件路径")
  };
}

async function getUrlMetadata(text) {
  const info = parseUrlInfo(text);
  if (!info) return null;

  const metadata = {
    url: info.url,
    urlHost: info.host,
    urlKind: info.label,
    urlTime: info.isYouTube ? formatYouTubeTime(info.time) : ""
  };

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(info.url, {
      cache: "force-cache",
      signal: controller.signal
    });
    const type = response.headers.get("content-type") || "";
    if (type && !type.includes("text/html")) {
      return metadata;
    }

    const html = await response.text();
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      .replace(/\s+/g, " ")
      .trim();
    if (title) {
      metadata.urlTitle = title.slice(0, 120);
    }
  } catch {
    // URL title enrichment is optional. Domain/type context is still useful.
  } finally {
    window.clearTimeout(timeout);
  }

  return metadata;
}

function contextLine(item) {
  const parts = [];
  const urlInfo = parseUrlInfo(item.text || item.sourceUrl || "");
  const fileInfo = filePathInfo(item.text);

  if (item.urlTitle) {
    parts.push(`页面：${item.urlTitle}`);
  } else if (item.sourceTitle) {
    parts.push(`页面：${item.sourceTitle}`);
  } else if (item.urlKind || urlInfo?.label) {
    parts.push(item.urlKind || urlInfo.label);
  }

  if (item.urlHost || urlInfo?.host || item.sourceUrl) {
    const sourceHost = item.sourceUrl ? parseUrlInfo(item.sourceUrl)?.host : "";
    parts.push(item.urlHost || urlInfo?.host || sourceHost);
  }

  if (item.urlTime || urlInfo?.time) {
    parts.push(`时间点 ${item.urlTime || formatYouTubeTime(urlInfo.time)}`);
  }

  if (fileInfo) {
    parts.push(`${fileInfo.type}：${fileInfo.fileName}`);
    if (fileInfo.count > 1) parts.push(`${fileInfo.count} 个路径`);
    if (fileInfo.folder) parts.push(`目录：${fileInfo.folder}`);
  }

  if (item.sourceApp) {
    parts.push(`来自 ${item.sourceApp}`);
  }

  if (item.sourceWindow) {
    parts.push(`窗口：${item.sourceWindow}`);
  }

  if (item.kind === "file" && item.mime?.startsWith("image/")) {
    parts.push("截图或图片");
  }

  return parts.join(" / ");
}

function adviceForItem(item) {
  const tags = item.tags || [];
  const urlInfo = parseUrlInfo(item.text || "");
  const fileInfo = filePathInfo(item.text);

  if (tags.some((tag) => ["稍后看", "要发送", "素材", "待处理"].includes(tag))) {
    return { label: "建议保存", type: "save", reason: "已有用途标签" };
  }

  if (item.kind === "file" && item.mime?.startsWith("image/")) {
    return null;
  }

  if (urlInfo || fileInfo) {
    return { label: "建议暂存", type: "stash", reason: "链接或路径需要确认用途" };
  }

  if (normalizeText(item.text).length < 18) {
    return { label: "建议删除", type: "delete", reason: "短文本更像临时中转" };
  }

  return { label: "建议暂存", type: "stash", reason: "普通文本，先确认上下文" };
}

function getVisibleItems() {
  const query = state.query.toLowerCase();
  const today = todayKey();

  return state.items
    .filter((item) => {
      if (state.filter === "active") return item.status === "active" && item.day === today;
      if (state.filter === "stashed") return item.status === "stashed";
      if (state.filter === "cleanup") return item.status === "active";
      return true;
    })
    .filter((item) => {
      if (!query) return true;
      const haystack = [
        item.title,
        item.text,
        item.fileName,
        item.mime,
        item.sourceApp,
        item.sourceWindow,
        item.sourceTitle,
        item.sourceUrl,
        item.urlTitle,
        item.urlHost,
        ...(item.tags || [])
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function setViewCopy() {
  const copy = {
    active: ["今日临泊内容", ""],
    stashed: ["已暂存车位", "这些内容不会被下班清场误删。"],
    all: ["全部临泊记录", "包含今天、历史和暂存的所有项目。"],
    cleanup: ["下班清场队列", "根据上下文判断删除、暂存，或保存到本地。"]
  }[state.filter];

  els.viewTitle.textContent = copy[0];
  els.viewHint.textContent = copy[1];
  els.viewHint.hidden = !copy[1];
}

function setFilter(filter) {
  state.filter = filter;
  els.filters.forEach((node) => node.classList.toggle("is-active", node.dataset.filter === filter));
  renderItems();
}

function renderLimitReminder() {
  const count = pendingItemCount();
  const shouldShow = count > ITEM_LIMIT && dismissedLimitCount() < count;

  els.limitReminder.hidden = !shouldShow;
  if (!shouldShow) return;

  els.limitReminderText.textContent = `现在有 ${count} 条待处理内容，建议清理到 ${ITEM_LIMIT} 条以内。`;
}

function renderStats() {
  els.totalCount.textContent = state.items.length;
  els.fileCount.textContent = state.items.filter((item) => item.kind === "file").length;
  els.stashCount.textContent = state.items.filter((item) => item.status === "stashed").length;
  renderLimitReminder();
}

function renderItems() {
  const visibleItems = getVisibleItems();
  els.itemsList.replaceChildren();

  if (!visibleItems.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有匹配的内容。";
    els.itemsList.append(empty);
    setViewCopy();
    renderStats();
    return;
  }

  const groups = new Map();
  for (const item of visibleItems) {
    const key = sessionKey(item.createdAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const [key, groupItems] of groups) {
    const group = document.createElement("section");
    group.className = "session-group";

    const title = document.createElement("h3");
    title.className = "session-title";
    title.textContent = sessionLabel(key);
    group.append(title);

    for (const item of groupItems) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.dataset.itemId = item.id;
    node.querySelector(".item-kind").textContent = item.kind === "file" ? "文件" : "文本";
    node.querySelector(".item-time").textContent = formatDateTime(item.createdAt);
    node.querySelector(".item-title").textContent = item.title;
    node.querySelector(".item-preview").textContent = item.kind === "file"
      ? `${item.mime || "未知类型"} · ${bytesToLabel(item.size)}`
      : item.text.slice(0, 220);

    const context = contextLine(item);
    const contextNode = node.querySelector(".item-context");
    contextNode.textContent = context || "暂无来源上下文";

    const adviceWrap = node.querySelector(".item-advice");
    const advice = state.filter === "cleanup" ? adviceForItem(item) : null;
    if (advice) {
      const adviceNode = document.createElement("span");
      adviceNode.className = `advice-pill ${advice.type}`;
      adviceNode.textContent = `${advice.label} · ${advice.reason}`;
      adviceWrap.append(adviceNode);
    } else {
      adviceWrap.hidden = true;
    }

    if (item.kind === "file" && item.mime?.startsWith("image/") && item.blob) {
      const image = document.createElement("img");
      image.className = "item-media";
      image.src = URL.createObjectURL(item.blob);
      image.alt = item.title;
      node.querySelector(".item-main").append(image);
    }

    const tags = node.querySelector(".item-tags");
    if (item.sourceUrl) {
      const sourceTag = document.createElement("span");
      sourceTag.className = "tag";
      sourceTag.textContent = "来源网页";
      tags.append(sourceTag);
    }

    for (const tag of item.tags || []) {
      const tagNode = document.createElement("span");
      tagNode.className = "tag";
      tagNode.textContent = tag;
      tags.append(tagNode);
    }

    const quickTags = node.querySelector(".quick-tags");
    for (const tag of ["稍后看", "要发送", "素材", "待处理", "不重要"]) {
      const button = document.createElement("button");
      button.className = "quick-tag";
      button.type = "button";
      button.textContent = tag;
      button.classList.toggle("is-active", (item.tags || []).includes(tag));
      button.addEventListener("click", () => addQuickTag(item, tag));
      quickTags.append(button);
    }

    const copyButton = node.querySelector(".copy-action");
    copyButton.disabled = item.kind !== "text";
    copyButton.addEventListener("click", () => copyItem(item));

    const downloadButton = node.querySelector(".download-action");
    downloadButton.addEventListener("click", () => downloadItem(item));

    const stashButton = node.querySelector(".stash-action");
    stashButton.textContent = item.status === "stashed" ? "取消暂存" : "暂存";
    stashButton.addEventListener("click", () => toggleStash(item));

    node.querySelector(".delete-action").addEventListener("click", () => removeItem(item, node));
    group.append(node);
    }

    els.itemsList.append(group);
  }

  setViewCopy();
  renderStats();
}

async function refresh() {
  state.items = await getAllItems();
  if (await removeDuplicateTextItems(state.items)) {
    state.items = await getAllItems();
  }
  state.companionIds = new Set(state.items.map((item) => item.id));
  renderItems();
}

async function saveText() {
  const text = els.textInput.value.trim();
  if (!text) {
    showToast("没有可保存的文本");
    return;
  }

  const title = text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "文本片段";
  const urlMetadata = await getUrlMetadata(text);
  await putItem({
    id: makeId(),
    kind: "text",
    title,
    text,
    tags: tagsFromInput(),
    status: "active",
    day: todayKey(),
    createdAt: Date.now(),
    ...(urlMetadata || {})
  });

  els.textInput.value = "";
  showToast("文本已保存");
  await refresh();
  signalItemsChanged();
}

async function saveFiles(files) {
  const tags = tagsFromInput();
  let count = 0;

  for (const file of files) {
    await putItem({
      id: makeId(),
      kind: "file",
      title: file.name,
      fileName: file.name,
      mime: file.type,
      size: file.size,
      blob: file,
      tags,
      status: "active",
      day: todayKey(),
      createdAt: Date.now()
    });
    count += 1;
  }

  if (count) {
    showToast(`已保存 ${count} 个文件`);
    await refresh();
    signalItemsChanged();
  }
}

async function readClipboard() {
  try {
    const items = await navigator.clipboard.read();
    let saved = 0;

    for (const clipboardItem of items) {
      for (const type of clipboardItem.types) {
        const blob = await clipboardItem.getType(type);
        if (type.startsWith("text/")) {
          els.textInput.value = await blob.text();
        } else {
          const extension = type.split("/")[1] || "bin";
          const file = new File([blob], `clipboard-${Date.now()}.${extension}`, { type });
          await saveFiles([file]);
          saved += 1;
        }
      }
    }

    showToast(saved ? "剪贴板文件已保存" : "剪贴板文本已读取");
  } catch (error) {
    showToast("请使用 Ctrl+V 粘贴，浏览器限制了直接读取");
  }
}

async function copyItem(item) {
  await navigator.clipboard.writeText(item.text);
  showToast("已复制");
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadItem(item) {
  if (item.kind === "file") {
    downloadBlob(item.blob, item.fileName || item.title);
    return;
  }

  const blob = new Blob([item.text], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${item.title.slice(0, 40) || "clipboard"}.txt`);
}

function exportVisible() {
  const items = getVisibleItems().map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    text: item.kind === "text" ? item.text : undefined,
    fileName: item.fileName,
    mime: item.mime,
    size: item.size,
    tags: item.tags,
    sourceApp: item.sourceApp,
    sourceWindow: item.sourceWindow,
    sourceTitle: item.sourceTitle,
    sourceUrl: item.sourceUrl,
    urlTitle: item.urlTitle,
    urlHost: item.urlHost,
    urlKind: item.urlKind,
    urlTime: item.urlTime,
    status: item.status,
    createdAt: new Date(item.createdAt).toISOString()
  }));

  const blob = new Blob([JSON.stringify(items, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  downloadBlob(blob, `work-clipboard-${todayKey()}.json`);
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

async function importCompanionItems() {
  try {
    const response = await fetch("http://127.0.0.1:18765/", { cache: "no-store" });
    if (!response.ok) return;

    const data = await response.json();
    els.companionStatus.textContent = "系统剪贴板已连接";
    els.companionStatus.classList.add("is-connected");
    const incoming = Array.isArray(data.items) ? data.items : [];
    const existingTextKeys = new Set(
      state.items
        .filter((existingItem) => existingItem.kind === "text")
        .map((existingItem) => textNearDuplicateKey(existingItem.text))
        .filter(Boolean)
    );
    let changed = false;

    for (const item of incoming) {
      if (!item.id || state.companionIds.has(item.id) || state.deletedCompanionIds.has(item.id)) {
        continue;
      }

      if (item.type === "image" && item.base64) {
        const blob = base64ToBlob(item.base64, item.mime || "image/png");
        await putItem({
          id: item.id,
          kind: "file",
          title: item.title || "屏幕截图",
          fileName: item.fileName || `${item.id}.png`,
          mime: item.mime || "image/png",
          size: item.size || blob.size,
          blob,
          tags: item.tags || ["系统剪贴板"],
          sourceApp: item.sourceApp || "",
          sourceWindow: item.sourceWindow || "",
          status: "active",
          day: todayKey(new Date(item.createdAt || Date.now())),
          createdAt: item.createdAt || Date.now()
        });
      } else if (item.type === "text" && item.text) {
        const key = textNearDuplicateKey(item.text);
        if (existingTextKeys.has(key)) {
          state.companionIds.add(item.id);
          continue;
        }

        const urlMetadata = await getUrlMetadata(item.text);

        await putItem({
          id: item.id,
          kind: "text",
          title: (item.title || item.text.split(/\r?\n/).find(Boolean) || "系统复制内容").slice(0, 80),
          text: item.text,
          tags: item.tags || ["系统剪贴板"],
          sourceApp: item.sourceApp || "",
          sourceWindow: item.sourceWindow || "",
          ...(urlMetadata || {}),
          status: "active",
          day: todayKey(new Date(item.createdAt || Date.now())),
          createdAt: item.createdAt || Date.now()
        });
      } else {
        continue;
      }

      state.companionIds.add(item.id);
      if (item.type === "text") {
        existingTextKeys.add(textNearDuplicateKey(item.text));
      }
      changed = true;
    }

    if (changed) {
      await refresh();
      signalItemsChanged();
    }
  } catch {
    els.companionStatus.textContent = "仅浏览器内捕获";
    els.companionStatus.classList.remove("is-connected");
    // The companion is optional. When it is not running, the extension still works for manual capture.
  }
}

async function toggleStash(item) {
  await putItem({
    ...item,
    status: item.status === "stashed" ? "active" : "stashed"
  });
  showToast(item.status === "stashed" ? "已取消暂存" : "已暂存");
  await refresh();
  signalItemsChanged();
}

async function addQuickTag(item, tag) {
  const tags = uniqueTags([...(item.tags || []), tag]);
  await putItem({ ...item, tags });
  showToast(`已标记：${tag}`);
  await refresh();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function confirmDelete(item) {
  return new Promise((resolve) => {
    els.confirmText.textContent = `「${item.title}」将从临泊站清出。`;
    els.confirmModal.hidden = false;

    const cleanup = (answer) => {
      els.confirmModal.hidden = true;
      els.cancelDeleteButton.removeEventListener("click", onCancel);
      els.confirmDeleteButton.removeEventListener("click", onConfirm);
      resolve(answer);
    };

    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);

    els.cancelDeleteButton.addEventListener("click", onCancel);
    els.confirmDeleteButton.addEventListener("click", onConfirm);
  });
}

function playDeleteSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContext();
    const notes = [
      [784, 0, 0.12, 0.045],
      [1047, 0.045, 0.13, 0.045],
      [1319, 0.095, 0.15, 0.04],
      [1568, 0.16, 0.11, 0.025]
    ];

    notes.forEach(([frequency, offset, duration, volume]) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + offset;
      const end = start + duration;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.92, end);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.001, end);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });
  } catch {
    // Audio feedback is optional.
  }
}

function burstConfetti(originNode) {
  const rect = originNode.getBoundingClientRect();
  const colors = ["#19c8b1", "#f4fffb", "#d5ad47", "#8feee2", "#2f73d8", "#12332d"];
  const centerX = rect.left + rect.width * 0.72;
  const centerY = rect.top + Math.min(rect.height * 0.45, 120);

  for (let index = 0; index < 56; index += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti";
    const angle = -145 + Math.random() * 110;
    const distance = 90 + Math.random() * 260;
    const drift = -90 + Math.random() * 180;
    const x = Math.cos((angle * Math.PI) / 180) * distance;
    const y = Math.sin((angle * Math.PI) / 180) * distance + 190 + Math.random() * 120;
    const width = 5 + Math.random() * 5;
    const height = 7 + Math.random() * 8;

    piece.style.left = `${centerX + drift * 0.22}px`;
    piece.style.top = `${centerY}px`;
    piece.style.width = `${width}px`;
    piece.style.height = `${height}px`;
    piece.style.setProperty("--dx", `${x + drift}px`);
    piece.style.setProperty("--dy", `${y}px`);
    piece.style.setProperty("--spin", `${180 + Math.random() * 620}deg`);
    piece.style.background = colors[index % colors.length];
    piece.style.animationDelay = `${Math.random() * 160}ms`;
    piece.style.animationDuration = `${1250 + Math.random() * 550}ms`;
    els.celebrationLayer.append(piece);
    window.setTimeout(() => piece.remove(), 2100);
  }
}

async function removeItem(item, node) {
  const confirmed = await confirmDelete(item);
  if (!confirmed) return;

  playDeleteSound();
  if (node) {
    burstConfetti(node);
    node.classList.add("is-removing");
    await wait(420);
  }

  rememberDeletedCompanionId(item.id);
  await deleteItem(item.id);
  state.companionIds.delete(item.id);
  showToast("已清出车位");
  await refresh();
  signalItemsChanged();
}

function handlePaste(event) {
  const files = [...event.clipboardData.files];
  if (files.length) {
    event.preventDefault();
    saveFiles(files);
    return;
  }

  const text = event.clipboardData.getData("text/plain");
  if (text && document.activeElement !== els.textInput) {
    event.preventDefault();
    els.textInput.value = text;
    saveText();
  }
}

function bindEvents() {
  syncDeletedCompanionIdsToStorage();

  if (location.hash === "#cleanup") {
    state.filter = "cleanup";
    els.filters.forEach((node) => node.classList.toggle("is-active", node.dataset.filter === "cleanup"));
  }

  els.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());

  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter);
    });
  });

  els.cleanupButton.addEventListener("click", () => {
    setFilter("cleanup");
  });

  els.limitCleanupButton.addEventListener("click", () => {
    setFilter("cleanup");
  });

  els.limitDismissButton.addEventListener("click", () => {
    localStorage.setItem(LIMIT_REMINDER_KEY, String(pendingItemCount()));
    renderLimitReminder();
  });

  els.searchInput.addEventListener("input", () => {
    state.query = els.searchInput.value.trim();
    renderItems();
  });

  els.fileButton.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => saveFiles([...els.fileInput.files]));
  els.pasteButton.addEventListener("click", readClipboard);
  els.saveTextButton.addEventListener("click", saveText);
  els.exportVisibleButton.addEventListener("click", exportVisible);

  els.textInput.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      event.preventDefault();
      saveText();
    }
  });

  document.addEventListener("paste", handlePaste);
  window.addEventListener("focus", refresh);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "ITEM_ADDED") {
      refresh();
    }
  });

  window.setInterval(importCompanionItems, 1500);
  importCompanionItems();

  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      els.dropZone.classList.add("is-over");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, () => {
      els.dropZone.classList.remove("is-over");
    });
  }

  els.dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    saveFiles([...event.dataTransfer.files]);
  });
}

bindEvents();
refresh();
