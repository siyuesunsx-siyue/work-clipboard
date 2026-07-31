const DB_NAME = "work-clipboard-db";
const DB_VERSION = 1;
const STORE = "items";
const DELETED_IDS_KEY = "work-clipboard-deleted-companion-ids";

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
  itemsList: document.querySelector("#itemsList"),
  template: document.querySelector("#itemTemplate"),
  toast: document.querySelector("#toast")
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
  localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...state.deletedCompanionIds].slice(-1000)));
}

function makeId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
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
        ...(item.tags || [])
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function setViewCopy() {
  const copy = {
    active: ["今天的中转内容", "粘贴、拖拽或读取剪贴板后会出现在这里。"],
    stashed: ["暂存内容", "暂存项不会被下班清理误删。"],
    all: ["全部内容", "包含今天、历史和暂存的所有项目。"],
    cleanup: ["下班清理队列", "逐项确认删除、暂存，或保存到本地。"]
  }[state.filter];

  els.viewTitle.textContent = copy[0];
  els.viewHint.textContent = copy[1];
}

function renderStats() {
  els.totalCount.textContent = state.items.length;
  els.fileCount.textContent = state.items.filter((item) => item.kind === "file").length;
  els.stashCount.textContent = state.items.filter((item) => item.status === "stashed").length;
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

  for (const item of visibleItems) {
    const node = els.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".item-kind").textContent = item.kind === "file" ? "文件" : "文本";
    node.querySelector(".item-time").textContent = formatDateTime(item.createdAt);
    node.querySelector(".item-title").textContent = item.title;
    node.querySelector(".item-preview").textContent = item.kind === "file"
      ? `${item.mime || "未知类型"} · ${bytesToLabel(item.size)}`
      : item.text.slice(0, 220);

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

    const copyButton = node.querySelector(".copy-action");
    copyButton.disabled = item.kind !== "text";
    copyButton.addEventListener("click", () => copyItem(item));

    const downloadButton = node.querySelector(".download-action");
    downloadButton.addEventListener("click", () => downloadItem(item));

    const stashButton = node.querySelector(".stash-action");
    stashButton.textContent = item.status === "stashed" ? "取消暂存" : "暂存";
    stashButton.addEventListener("click", () => toggleStash(item));

    node.querySelector(".delete-action").addEventListener("click", () => removeItem(item));
    els.itemsList.append(node);
  }

  setViewCopy();
  renderStats();
}

async function refresh() {
  state.items = await getAllItems();
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
  await putItem({
    id: makeId(),
    kind: "text",
    title,
    text,
    tags: tagsFromInput(),
    status: "active",
    day: todayKey(),
    createdAt: Date.now()
  });

  els.textInput.value = "";
  showToast("文本已保存");
  await refresh();
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
          status: "active",
          day: todayKey(new Date(item.createdAt || Date.now())),
          createdAt: item.createdAt || Date.now()
        });
      } else if (item.type === "text" && item.text) {
        await putItem({
          id: item.id,
          kind: "text",
          title: (item.title || item.text.split(/\r?\n/).find(Boolean) || "系统复制内容").slice(0, 80),
          text: item.text,
          tags: item.tags || ["系统剪贴板"],
          status: "active",
          day: todayKey(new Date(item.createdAt || Date.now())),
          createdAt: item.createdAt || Date.now()
        });
      } else {
        continue;
      }

      state.companionIds.add(item.id);
      changed = true;
    }

    if (changed) {
      await refresh();
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
}

async function removeItem(item) {
  const confirmed = confirm(`永久删除「${item.title}」？`);
  if (!confirmed) return;

  rememberDeletedCompanionId(item.id);
  await deleteItem(item.id);
  state.companionIds.delete(item.id);
  showToast("已删除");
  await refresh();
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
  els.todayLabel.textContent = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date());

  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      els.filters.forEach((node) => node.classList.toggle("is-active", node === button));
      renderItems();
    });
  });

  els.cleanupButton.addEventListener("click", () => {
    state.filter = "cleanup";
    els.filters.forEach((node) => node.classList.toggle("is-active", node.dataset.filter === "cleanup"));
    renderItems();
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
