const DB_NAME = "work-clipboard-db";
const DB_VERSION = 1;
const STORE = "items";
const DELETED_IDS_KEY = "work-clipboard-deleted-companion-ids";
const LIMIT_REMINDER_KEY = "parkit-limit-reminder-notified-count";
const ITEM_LIMIT = 20;
const COMPANION_URL = "http://127.0.0.1:18765/";
const LIMIT_NOTIFICATION_ID = "parkit-limit-reminder";

let dbPromise;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("newtab.html")
  });
});

chrome.runtime.onInstalled.addListener(() => {
  ensureBackgroundTasks();
  injectContentScriptIntoOpenTabs().catch((error) => {
    console.error("Failed to inject content script", error);
  });
  syncParkitState().catch((error) => {
    console.error("Failed to sync Parkit state", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureBackgroundTasks();
  syncParkitState().catch((error) => {
    console.error("Failed to sync Parkit state", error);
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "parkit-sync") return;

  syncParkitState().catch((error) => {
    console.error("Failed to sync Parkit state", error);
  });
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId !== LIMIT_NOTIFICATION_ID) return;

  chrome.tabs.create({
    url: chrome.runtime.getURL("newtab.html#cleanup")
  });
  chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ITEMS_CHANGED") {
    syncParkitState().catch((error) => {
      console.error("Failed to update Parkit state", error);
    });
    return;
  }

  if (message?.type !== "CAPTURED_COPY") return;

  saveCopiedText(message.payload).catch((error) => {
    console.error("Failed to save copied text", error);
  });
});

function ensureBackgroundTasks() {
  chrome.alarms.create("parkit-sync", { periodInMinutes: 1 });
}

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

async function putItem(item) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(item);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getAllItems() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getItem(id) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const store = transaction.objectStore(STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function makeId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function normalizeText(text) {
  return String(text || "").trim().replace(/\s+/g, " ");
}

function stableHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function isCompanionOnline() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 350);

  try {
    const response = await fetch(COMPANION_URL, {
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function notifyItemAdded() {
  chrome.runtime.sendMessage({ type: "ITEM_ADDED" }).catch(() => {});
}

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

async function deletedCompanionIds() {
  const result = await chrome.storage.local.get(DELETED_IDS_KEY);
  return new Set(result[DELETED_IDS_KEY] || []);
}

async function companionItems() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(COMPANION_URL, {
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return [];

    const data = await response.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function importCompanionItems() {
  const incoming = await companionItems();
  if (!incoming.length) return false;

  const deletedIds = await deletedCompanionIds();
  let changed = false;

  for (const item of incoming) {
    if (!item.id || deletedIds.has(item.id) || await getItem(item.id)) {
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
      changed = true;
    } else if (item.type === "text" && item.text) {
      await putItem({
        id: item.id,
        kind: "text",
        title: (item.title || item.text.split(/\r?\n/).find(Boolean) || "系统复制内容").slice(0, 80),
        text: item.text,
        tags: item.tags || ["系统剪贴板"],
        sourceApp: item.sourceApp || "",
        sourceWindow: item.sourceWindow || "",
        status: "active",
        day: todayKey(new Date(item.createdAt || Date.now())),
        createdAt: item.createdAt || Date.now()
      });
      changed = true;
    }
  }

  if (changed) {
    notifyItemAdded();
  }

  return changed;
}

async function updateLimitSignals() {
  const items = await getAllItems();
  const count = items.filter((item) => item.status === "active").length;

  if (count > ITEM_LIMIT) {
    await chrome.action.setBadgeText({ text: String(count) });
    await chrome.action.setBadgeBackgroundColor({ color: "#d94d4d" });
    await chrome.action.setTitle({ title: `Parkit: ${count} 条待处理内容` });
  } else {
    await chrome.action.setBadgeText({ text: "" });
    await chrome.action.setTitle({ title: "Open Parkit" });
    await chrome.storage.local.set({ [LIMIT_REMINDER_KEY]: 0 });
    return;
  }

  const stored = await chrome.storage.local.get(LIMIT_REMINDER_KEY);
  const lastNotifiedCount = Number(stored[LIMIT_REMINDER_KEY] || 0);
  if (lastNotifiedCount >= count) return;

  await chrome.notifications.create(LIMIT_NOTIFICATION_ID, {
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Parkit 需要清场了",
    message: `现在有 ${count} 条待处理内容，建议处理到 ${ITEM_LIMIT} 条以内。`
  });
  await chrome.storage.local.set({ [LIMIT_REMINDER_KEY]: count });
}

async function syncParkitState() {
  await importCompanionItems();
  await updateLimitSignals();
}

function canInject(tab) {
  return Boolean(
    tab.id &&
    tab.url &&
    /^(https?|file):\/\//.test(tab.url)
  );
}

async function injectContentScriptIntoOpenTabs() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs.filter(canInject)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content-script.js"]
      });
    } catch {
      // Chrome blocks protected pages and some extension pages.
    }
  }
}

async function saveCopiedText(payload) {
  if (!payload?.text) return;

  if (await isCompanionOnline()) {
    return;
  }

  const normalizedText = normalizeText(payload.text);
  if (!normalizedText) return;

  const title = payload.text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "网页复制内容";

  await putItem({
    id: `web-text-${stableHash(normalizedText)}`,
    kind: "text",
    title,
    text: payload.text,
    html: payload.html,
    sourceTitle: payload.pageTitle,
    sourceUrl: payload.pageUrl,
    tags: ["自动捕获", "网页复制"],
    status: "active",
    day: todayKey(),
    createdAt: Date.now()
  });

  notifyItemAdded();
  await updateLimitSignals();
}

ensureBackgroundTasks();
syncParkitState().catch((error) => {
  console.error("Failed to initialize Parkit state", error);
});
