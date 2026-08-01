if (!globalThis.__workClipboardContentScriptLoaded) {
  globalThis.__workClipboardContentScriptLoaded = true;
  initWorkClipboardCapture();
}

function initWorkClipboardCapture() {
  let lastCopySignature = "";

  function selectedTextFromActiveElement() {
    const active = document.activeElement;
    const isTextControl = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

    if (!isTextControl || active.selectionStart === active.selectionEnd) {
      return "";
    }

    return active.value.slice(active.selectionStart, active.selectionEnd);
  }

  function selectedHtml() {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return "";
    }

    const wrapper = document.createElement("div");
    for (let index = 0; index < selection.rangeCount; index += 1) {
      wrapper.append(selection.getRangeAt(index).cloneContents());
    }

    return wrapper.innerHTML;
  }

  function selectedText() {
    return selectedTextFromActiveElement() || window.getSelection()?.toString() || "";
  }

  function sendCopiedText(text, html = "") {
    const cleanText = text.trim();

    if (!cleanText) return false;

    const signature = `${location.href}\n${cleanText}`;
    if (signature === lastCopySignature) return false;
    lastCopySignature = signature;

    chrome.runtime.sendMessage({
      type: "CAPTURED_COPY",
      payload: {
        text: cleanText,
        html,
        pageTitle: document.title,
        pageUrl: location.href
      }
    }).catch(() => {});

    return true;
  }

  async function readClipboardTextSoon() {
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
      const text = await navigator.clipboard.readText();
      sendCopiedText(text);
    } catch {
      // Some pages or browser settings block clipboard reads. The selection path still covers normal copies.
    }
  }

  document.addEventListener("copy", () => {
    const text = selectedText();
    const sentSelection = sendCopiedText(text, selectedHtml());
    if (!sentSelection) {
      readClipboardTextSoon();
    }
  }, true);

  document.addEventListener("keyup", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      readClipboardTextSoon();
    }
  }, true);
}
