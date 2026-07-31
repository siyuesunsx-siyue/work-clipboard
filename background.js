const DB_NAME = "work-clipboard-db";
const DB_VERSION = 1;
const STORE = "items";

let dbPromise;

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("newtab.html")
  });
});

chrome.runtime.onInstalled.addListener(() => {
  injectContentScriptIntoOpenTabs().catch((error) => {
    console.error("Failed to inject content script", error);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "CAPTURED_COPY") return;

  saveCopiedText(message.payload).catch((error) => {
    console.error("Failed to save copied text", error);
  });
});

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

function makeId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function notifyItemAdded() {
  chrome.runtime.sendMessage({ type: "ITEM_ADDED" }).catch(() => {});
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
  const title = payload.text.split(/\r?\n/).find(Boolean)?.slice(0, 80) || "网页复制内容";

  await putItem({
    id: makeId(),
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
}
