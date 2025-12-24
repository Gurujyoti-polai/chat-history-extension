(function () {
  let trackedMessages = new Set();
  let messageElements = new Map();
  let messageContents = new Map();
  let currentUrl = window.location.href;
  let tabId = null;
  let pendingUserMessages = new Map();
  let lastVisibleMessageIds = new Set();
  let messageOrder = [];

  const hostname = window.location.hostname;
  let platform = null;
  let config = null;

  const PLATFORMS = {
    "claude.ai": {
      messageSelector: "div[data-test-render-count]",
      isUserMessage: (el, idx) => {
        const hasUserTestId = el.querySelector('[data-testid="user-message"]');
        if (hasUserTestId) return true;

        const hasAssistantFont = el.innerHTML.includes("font-claude-response");
        const hasStreaming = el.querySelector("[data-is-streaming]");
        if (hasAssistantFont || hasStreaming) return false;

        const hasUserBg = el.innerHTML.includes("bg-bg-300");
        const hasItemsEnd = el.innerHTML.includes("items-end");

        return hasUserBg && hasItemsEnd;
      },
      isAssistantMessage: (el) => {
        const hasAssistantFont = el.innerHTML.includes("font-claude-response");
        const hasStreaming = el.querySelector("[data-is-streaming]");
        return hasAssistantFont || hasStreaming;
      },
      getContent: (el) => {
        const userMsg = el.querySelector('[data-testid="user-message"]');
        if (userMsg) return userMsg.textContent.trim();
        return el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (config.isAssistantMessage(allMessages[i])) {
            return true;
          }
        }
        return false;
      },
    },
    "chatgpt.com": {
      messageSelector: "[data-message-author-role]",
      isUserMessage: (el) =>
        el.getAttribute("data-message-author-role") === "user",
      isAssistantMessage: (el) =>
        el.getAttribute("data-message-author-role") === "assistant",
      getContent: (el) => {
        const markdown = el.querySelector(
          ".markdown, [data-message-content], .whitespace-pre-wrap"
        );
        return markdown ? markdown.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (
            allMessages[i].getAttribute("data-message-author-role") ===
            "assistant"
          ) {
            return true;
          }
        }
        return false;
      },
    },
    "gemini.google.com": {
      messageSelector: "user-query, model-response",
      isUserMessage: (el) => el.tagName.toLowerCase() === "user-query",
      isAssistantMessage: (el) => el.tagName.toLowerCase() === "model-response",
      getContent: (el) => {
        const textEl = el.querySelector('.query-text') || el.querySelector('.markdown');
        return textEl ? textEl.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (allMessages[i].tagName.toLowerCase() === "model-response") {
            return true;
          }
        }
        return false;
      },
    },
  };

  for (const [domain, cfg] of Object.entries(PLATFORMS)) {
    if (hostname.includes(domain)) {
      platform = domain;
      config = cfg;
      break;
    }
  }

  if (!platform) {
    return;
  }

  async function initializeTabId() {
    try {
      tabId =
        "tab_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem("chatTrackerTabId", tabId);
    } catch (e) {
      tabId =
        "tab_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    }
  }

  initializeTabId();

  function getStorageKey(url) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split("/").filter((p) => p.length > 0);

    let uniquePart = urlObj.pathname;
    if (pathParts.length > 0) {
      uniquePart = pathParts[pathParts.length - 1];
    }

    let hash = 0;
    const fullString = uniquePart + urlObj.search;
    for (let i = 0; i < fullString.length; i++) {
      hash = (hash << 5) - hash + fullString.charCodeAt(i);
    }

    return "chat_" + Math.abs(hash).toString(36) + "_" + tabId;
  }

  let storageKey = getStorageKey(currentUrl);

  function checkUrlChange() {
    const newUrl = window.location.href;

    if (newUrl !== currentUrl) {
      currentUrl = newUrl;
      storageKey = getStorageKey(currentUrl);

      trackedMessages.clear();
      messageElements.clear();
      messageContents.clear();
      pendingUserMessages.clear();
      lastVisibleMessageIds.clear();
      messageOrder = [];
    }
  }

  setInterval(checkUrlChange, 1000);

  setTimeout(captureMessages, 500);
  setInterval(captureMessages, 2000);

  let scrollTimeout;
  let lastScrollTime = 0;
  let isScrolling = false;

  window.addEventListener(
    "scroll",
    () => {
      const now = Date.now();

      detectCurrentPosition();
      lastScrollTime = now;
      isScrolling = true;

      clearTimeout(scrollTimeout);

      scrollTimeout = setTimeout(() => {
        isScrolling = false;
        detectCurrentPosition();
      }, 100);
    },
    { passive: true }
  );

  let observer;
  function setupIntersectionObserver() {
    if (observer) observer.disconnect();

    observer = new IntersectionObserver(
      (entries) => {
        if (!isScrolling) {
          detectCurrentPosition();
        }
      },
      {
        threshold: [0, 0.25, 0.5, 0.75, 1],
        rootMargin: "0px",
      }
    );

    const msgs = document.querySelectorAll(config.messageSelector);
    msgs.forEach((msg) => observer.observe(msg));
  }

  function detectCurrentPosition() {
    const msgs = document.querySelectorAll(config.messageSelector);
    if (!msgs.length) return;

    const viewportTop = 0;
    const TOP_BIAS_PX = 120;

    let bestCandidate = null;
    let bestScore = Infinity;

    msgs.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const msgId = el.dataset.trackedId;
      if (!msgId) return;

      if (rect.top > window.innerHeight) return;

      let score;

      if (rect.top >= viewportTop && rect.top <= TOP_BIAS_PX) {
        score = rect.top;
      } else {
        score = Math.abs(rect.top) + 500;
      }

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = msgId;
      }
    });

    if (bestCandidate) {
      chrome.runtime
        .sendMessage({
          action: "updateProgress",
          messageId: bestCandidate,
          storageKey,
          tabId,
        })
        .catch(() => {});
    }
  }

  async function captureMessages() {
    checkUrlChange();

    const msgs = document.querySelectorAll(config.messageSelector);
    const allMessages = Array.from(msgs);

    allMessages.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const currentVisibleIds = new Set();
    const newMessageOrder = [];
    
    allMessages.forEach((el) => {
      const txt = config.getContent(el);
      if (txt.length >= 5 && txt.length <= 10000) {
        const msgId = hashString(txt + storageKey);
        currentVisibleIds.add(msgId);
        newMessageOrder.push(msgId);
      }
    });

    const messagesDisappeared = Array.from(lastVisibleMessageIds).some(
      (id) => !currentVisibleIds.has(id)
    );

    const orderChanged = !arraysEqual(newMessageOrder, messageOrder.filter(id => currentVisibleIds.has(id)));

    if ((messagesDisappeared && lastVisibleMessageIds.size > 0) || orderChanged) {
      await rebuildConversation(allMessages);
      lastVisibleMessageIds = currentVisibleIds;
      messageOrder = newMessageOrder;
      detectCurrentPosition();
      return;
    }

    lastVisibleMessageIds = currentVisibleIds;
    messageOrder = newMessageOrder;

    const newMessages = [];

    const pendingToRemove = [];
    pendingUserMessages.forEach((msgData, msgId) => {
      const msgIndex = allMessages.findIndex((el) => {
        const content = config.getContent(el);
        return hashString(content + storageKey) === msgId;
      });

      if (
        msgIndex !== -1 &&
        config.hasAssistantResponse(allMessages, msgIndex)
      ) {
        pendingToRemove.push(msgId);
      }
    });

    pendingToRemove.forEach((msgId) => {
      pendingUserMessages.delete(msgId);
    });

    // Process all visible messages
    allMessages.forEach((el, idx) => {
      const txt = config.getContent(el);

      if (txt.length < 5 || txt.length > 10000) return;

      const msgId = hashString(txt + storageKey);

      messageContents.set(msgId, txt);

      if (!trackedMessages.has(msgId)) {
        trackedMessages.add(msgId);
      }

      el.dataset.trackedId = msgId;
      messageElements.set(msgId, el);

      const isUser = config.isUserMessage(el, idx);

      if (isUser && !trackedMessages.has(msgId + "_saved")) {
        const hasResponse = config.hasAssistantResponse(allMessages, idx);

        if (hasResponse) {
          trackedMessages.add(msgId + "_saved");
          newMessages.push({
            id: msgId,
            role: "user",
            content: txt,
            summary: txt.slice(0, 60) + (txt.length > 60 ? "..." : ""),
            timestamp: new Date().toISOString(),
            index: idx,
            domPosition: idx
          });

          pendingUserMessages.delete(msgId);
        } else {
          if (!pendingUserMessages.has(msgId)) {
            pendingUserMessages.set(msgId, {
              content: txt,
              timestamp: Date.now(),
              index: idx,
            });
          }
        }
      }
    });

    const now = Date.now();
    const messagesToRemove = [];
    pendingUserMessages.forEach((msgData, msgId) => {
      if (now - msgData.timestamp > 5000) {
        messagesToRemove.push(msgId);
        trackedMessages.delete(msgId + "_saved");
      }
    });

    messagesToRemove.forEach((msgId) => {
      pendingUserMessages.delete(msgId);
    });

    if (newMessages.length > 0) {
      await saveMessages(newMessages);
    }

    detectCurrentPosition();
  }

  async function rebuildConversation(allMessages) {
    trackedMessages.clear();
    messageElements.clear();
    messageContents.clear();
    pendingUserMessages.clear();

    allMessages.sort((a, b) => {
      const position = a.compareDocumentPosition(b);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    const messagesToSave = [];

    allMessages.forEach((el, idx) => {
      const txt = config.getContent(el);

      if (txt.length < 5 || txt.length > 10000) return;

      const msgId = hashString(txt + storageKey);

      messageContents.set(msgId, txt);
      trackedMessages.add(msgId);
      el.dataset.trackedId = msgId;
      messageElements.set(msgId, el);

      const isUser = config.isUserMessage(el, idx);

      if (isUser) {
        const hasResponse = config.hasAssistantResponse(allMessages, idx);

        if (hasResponse) {
          trackedMessages.add(msgId + "_saved");
          messagesToSave.push({
            id: msgId,
            role: "user",
            content: txt,
            summary: txt.slice(0, 60) + (txt.length > 60 ? "..." : ""),
            timestamp: new Date().toISOString(),
            index: idx,
            domPosition: idx
          });
        }
      }
    });

    const conversation = {
      url: window.location.href,
      title: document.title || `${platform} Chat`,
      createdAt: new Date().toISOString(),
      tabId: tabId,
      messages: messagesToSave,
    };

    await chrome.storage.local.set({ [storageKey]: conversation });

    chrome.runtime
      .sendMessage({
        action: "conversationRebuilt",
        storageKey: storageKey,
        tabId: tabId,
      })
      .catch(() => {});
  }

  async function saveMessages(newMessages) {
    const result = await chrome.storage.local.get(storageKey);
    const conversation = result[storageKey] || {
      url: window.location.href,
      title: document.title || `${platform} Chat`,
      createdAt: new Date().toISOString(),
      tabId: tabId,
      messages: [],
    };

    const existingIds = new Set(conversation.messages.map((m) => m.id));

    newMessages.forEach((msg) => {
      if (!existingIds.has(msg.id)) {
        conversation.messages.push(msg);
      }
    });

    await chrome.storage.local.set({ [storageKey]: conversation });
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 200); i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
    }
    return Math.abs(hash).toString(36);
  }

  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  async function forceLoadAllMessages() {
    const scrollContainer = findScrollContainer();
    if (!scrollContainer) return window.scrollY;
    
    const originalScrollPos = scrollContainer.scrollTop || window.scrollY;

    if (scrollContainer === document.body || scrollContainer === document.documentElement) {
      window.scrollTo({ top: 0, behavior: "auto" });
    } else {
      scrollContainer.scrollTop = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));

    const scrollHeight = scrollContainer.scrollHeight || document.documentElement.scrollHeight;
    const clientHeight = scrollContainer.clientHeight || window.innerHeight;
    const maxScroll = scrollHeight - clientHeight;

    const steps = 8;
    const stepSize = maxScroll / steps;

    for (let i = 0; i <= steps; i++) {
      const targetScroll = stepSize * i;
      if (scrollContainer === document.body || scrollContainer === document.documentElement) {
        window.scrollTo({ top: targetScroll, behavior: "auto" });
      } else {
        scrollContainer.scrollTop = targetScroll;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      await captureMessages();
    }

    if (scrollContainer === document.body || scrollContainer === document.documentElement) {
      window.scrollTo({ top: maxScroll, behavior: "auto" });
    } else {
      scrollContainer.scrollTop = maxScroll;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    await captureMessages();

    if (scrollContainer === document.body || scrollContainer === document.documentElement) {
      window.scrollTo({ top: originalScrollPos, behavior: "auto" });
    } else {
      scrollContainer.scrollTop = originalScrollPos;
    }

    return originalScrollPos;
  }

  function findScrollContainer() {
    if (platform === "gemini.google.com") {
      const geminiContainer = document.querySelector('.mat-sidenav-content');
      if (geminiContainer) return geminiContainer;
    }
    
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const scrollable = findScrollableAncestor(mainEl);
      if (scrollable && scrollable !== document.body && scrollable !== document.documentElement) {
        return scrollable;
      }
    }
    
    return document.documentElement || document.body;
  }

  function findScrollableAncestor(node) {
    let current = node;
    while (current && current !== document.body) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY || style.overflow;
      if (/(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  async function findAndScrollToMessage(messageId, targetContent) {
    let el = document.querySelector(`[data-tracked-id="${messageId}"]`);
    if (el && document.contains(el)) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightElement(el);
      sendProgressUpdate(messageId);
      return true;
    }

    const msgs = document.querySelectorAll(config.messageSelector);
    for (const msg of msgs) {
      const content = config.getContent(msg);
      const computedId = hashString(content + storageKey);

      if (computedId === messageId) {
        msg.dataset.trackedId = messageId;
        messageElements.set(messageId, msg);
        msg.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightElement(msg);
        sendProgressUpdate(messageId);
        return true;
      }
    }

    await forceLoadAllMessages();

    el = document.querySelector(`[data-tracked-id="${messageId}"]`);
    if (el && document.contains(el)) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      highlightElement(el);
      sendProgressUpdate(messageId);
      return true;
    }

    const allMsgs = document.querySelectorAll(config.messageSelector);
    for (const msg of allMsgs) {
      const content = config.getContent(msg);
      const computedId = hashString(content + storageKey);

      if (computedId === messageId || (targetContent && content.includes(targetContent.substring(0, 50)))) {
        msg.dataset.trackedId = messageId;
        messageElements.set(messageId, msg);
        msg.scrollIntoView({ behavior: "smooth", block: "center" });
        highlightElement(msg);
        sendProgressUpdate(messageId);
        return true;
      }
    }

    return false;
  }

  function sendProgressUpdate(messageId) {
    chrome.runtime.sendMessage({
      action: "updateProgress",
      messageId: messageId,
      storageKey: storageKey,
      tabId: tabId,
    });
  }

  function highlightElement(el) {
    const originalTransform = el.style.transform;
    el.style.transition = "transform 0.2s ease";
    el.style.transform = "scale(1.01)";

    setTimeout(() => {
      el.style.transform = originalTransform;
      setTimeout(() => {
        el.style.transition = "";
      }, 200);
    }, 200);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "ping") {
      sendResponse({ success: true, ready: true, tabId: tabId });
      return true;
    }

    if (request.action === "getTabId") {
      sendResponse({ tabId: tabId });
      return true;
    }

    if (request.action === "getCurrentPosition") {
      const allMessages = document.querySelectorAll(config.messageSelector);
      if (allMessages.length === 0) {
        sendResponse({ messageId: null, tabId: tabId });
        return true;
      }

      const TOP_BIAS_PX = 120;
      let bestId = null;
      let bestScore = Infinity;

      allMessages.forEach((msg) => {
        const rect = msg.getBoundingClientRect();
        const msgId = msg.dataset.trackedId;
        if (!msgId) return;

        let score;

        if (rect.top >= 0 && rect.top <= TOP_BIAS_PX) {
          score = rect.top;
        } else {
          score = Math.abs(rect.top) + 500;
        }

        if (score < bestScore) {
          bestScore = score;
          bestId = msgId;
        }
      });

      sendResponse({ messageId: bestId, tabId });
      return true;
    }

    if (request.action === "scanNow") {
      captureMessages().then(() => {
        sendResponse({ success: true, tabId: tabId });
      });
      return true;
    }

    if (request.action === "loadAllMessages") {
      forceLoadAllMessages().then(() => {
        sendResponse({ success: true, tabId: tabId });
      });
      return true;
    }

    if (request.action === "highlightMessage") {
      const targetContent =
        messageContents.get(request.messageId) || request.messageContent || "";

      findAndScrollToMessage(request.messageId, targetContent)
        .then((success) => {
          sendResponse({ success });
        })
        .catch((error) => {
          sendResponse({ success: false });
        });

      return true;
    }

    return true;
  });
})();