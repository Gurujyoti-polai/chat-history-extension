(function() {
  let trackedMessages = new Set();
  let messageElements = new Map();
  let messageContents = new Map();
  let lastMessageCount = 0;
  let currentUrl = window.location.href;
  let tabId = null;
  let pendingUserMessages = new Map();
  let lastVisibleMessageIds = new Set(); // Track currently visible messages
  
  const hostname = window.location.hostname;
  let platform = null;
  let config = null;
  
  const PLATFORMS = {
    'claude.ai': {
      messageSelector: 'div[data-test-render-count]',
      isUserMessage: (el, idx) => {
        const hasUserTestId = el.querySelector('[data-testid="user-message"]');
        if (hasUserTestId) return true;
        
        const hasAssistantFont = el.innerHTML.includes('font-claude-response');
        const hasStreaming = el.querySelector('[data-is-streaming]');
        if (hasAssistantFont || hasStreaming) return false;
        
        const hasUserBg = el.innerHTML.includes('bg-bg-300');
        const hasItemsEnd = el.innerHTML.includes('items-end');
        
        return hasUserBg && hasItemsEnd;
      },
      isAssistantMessage: (el) => {
        const hasAssistantFont = el.innerHTML.includes('font-claude-response');
        const hasStreaming = el.querySelector('[data-is-streaming]');
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
      // Detect if chat was edited/branched
      detectBranch: (el) => {
        // Check for branch indicators in Claude
        const hasBranchButton = el.querySelector('[aria-label*="branch"]') || 
                               el.querySelector('[title*="branch"]');
        return !!hasBranchButton;
      }
    },
    'chat.openai.com': {
      messageSelector: '[data-message-author-role]',
      isUserMessage: (el) => el.getAttribute('data-message-author-role') === 'user',
      isAssistantMessage: (el) => el.getAttribute('data-message-author-role') === 'assistant',
      getContent: (el) => {
        const markdown = el.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap');
        return markdown ? markdown.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (allMessages[i].getAttribute('data-message-author-role') === 'assistant') {
            return true;
          }
        }
        return false;
      },
      detectBranch: (el) => {
        return false; // ChatGPT handles this differently
      }
    },
    'chatgpt.com': {
      messageSelector: '[data-message-author-role]',
      isUserMessage: (el) => el.getAttribute('data-message-author-role') === 'user',
      isAssistantMessage: (el) => el.getAttribute('data-message-author-role') === 'assistant',
      getContent: (el) => {
        const markdown = el.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap');
        return markdown ? markdown.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (allMessages[i].getAttribute('data-message-author-role') === 'assistant') {
            return true;
          }
        }
        return false;
      },
      detectBranch: (el) => {
        return false;
      }
    },
    'gemini.google.com': {
      messageSelector: 'user-query, model-response',
      isUserMessage: (el) => el.tagName.toLowerCase() === 'user-query',
      isAssistantMessage: (el) => el.tagName.toLowerCase() === 'model-response',
      getContent: (el) => el.textContent.trim(),
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        for (let i = userMessageIndex + 1; i < allMessages.length; i++) {
          if (allMessages[i].tagName.toLowerCase() === 'model-response') {
            return true;
          }
        }
        return false;
      },
      detectBranch: (el) => {
        return false;
      }
    }
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
      tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('chatTrackerTabId', tabId);
    } catch (e) {
      tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
  }
  
  initializeTabId();
  
  function getStorageKey(url) {
    const urlObj = new URL(url);
    const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
    
    let uniquePart = urlObj.pathname;
    if (pathParts.length > 0) {
      uniquePart = pathParts[pathParts.length - 1];
    }
    
    let hash = 0;
    const fullString = uniquePart + urlObj.search;
    for (let i = 0; i < fullString.length; i++) {
      hash = ((hash << 5) - hash) + fullString.charCodeAt(i);
    }
    
    return 'chat_' + Math.abs(hash).toString(36) + '_' + tabId;
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
      lastMessageCount = 0;
    }
  }

  setInterval(checkUrlChange, 1000);
  
  setTimeout(captureMessages, 500);
  setInterval(captureMessages, 2000);

  let scrollTimeout;
  let lastScrollTime = 0;
  let isScrolling = false;
  
  window.addEventListener('scroll', () => {
    const now = Date.now();
    
    detectCurrentPosition();
    lastScrollTime = now;
    isScrolling = true;
    
    clearTimeout(scrollTimeout);
    
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      detectCurrentPosition();
    }, 100);
  }, { passive: true });
  
  let observer;
  function setupIntersectionObserver() {
    if (observer) observer.disconnect();
    
    observer = new IntersectionObserver((entries) => {
      if (!isScrolling) {
        detectCurrentPosition();
      }
    }, {
      threshold: [0, 0.25, 0.5, 0.75, 1],
      rootMargin: '0px'
    });
    
    const msgs = document.querySelectorAll(config.messageSelector);
    msgs.forEach(msg => observer.observe(msg));
  }

  function detectCurrentPosition() {
    const msgs = document.querySelectorAll(config.messageSelector);
    if (msgs.length === 0) return;

    const viewportCenter = window.innerHeight / 2;
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;
    
    let closestId = null;
    let minDistance = Infinity;

    msgs.forEach(el => {
      const rect = el.getBoundingClientRect();
      const elementTop = rect.top + viewportTop;
      const elementBottom = elementTop + rect.height;
      
      if (elementBottom < viewportTop - 500 || elementTop > viewportBottom + 500) {
        return;
      }
      
      const elementCenter = rect.top + rect.height / 2;
      const distance = Math.abs(elementCenter - viewportCenter);
      const msgId = el.dataset.trackedId;
      
      if (msgId && distance < minDistance) {
        minDistance = distance;
        closestId = msgId;
      }
    });

    if (closestId) {
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        messageId: closestId,
        storageKey: storageKey,
        tabId: tabId
      }).catch(() => {});
    }
  }

  async function captureMessages() {
    checkUrlChange();
    
    const msgs = document.querySelectorAll(config.messageSelector);
    const allMessages = Array.from(msgs);
    
    // Get current visible message IDs
    const currentVisibleIds = new Set();
    allMessages.forEach(el => {
      const txt = config.getContent(el);
      if (txt.length >= 5 && txt.length <= 10000) {
        const msgId = hashString(txt + storageKey);
        currentVisibleIds.add(msgId);
      }
    });
    
    // Detect if messages disappeared (branch/edit scenario)
    const messagesDisappeared = Array.from(lastVisibleMessageIds).some(id => !currentVisibleIds.has(id));
    
    if (messagesDisappeared && lastVisibleMessageIds.size > 0) {
      // Branch detected - rebuild the conversation from scratch
      await rebuildConversation(allMessages);
      lastVisibleMessageIds = currentVisibleIds;
      detectCurrentPosition();
      return;
    }
    
    lastVisibleMessageIds = currentVisibleIds;
    
    if (msgs.length !== lastMessageCount) {
      lastMessageCount = msgs.length;
    }
    
    const newMessages = [];
    
    // Clean up old pending messages that now have responses
    const pendingToRemove = [];
    pendingUserMessages.forEach((msgData, msgId) => {
      const msgIndex = allMessages.findIndex(el => {
        const content = config.getContent(el);
        return hashString(content + storageKey) === msgId;
      });
      
      if (msgIndex !== -1 && config.hasAssistantResponse(allMessages, msgIndex)) {
        pendingToRemove.push(msgId);
      }
    });
    
    pendingToRemove.forEach(msgId => {
      pendingUserMessages.delete(msgId);
    });
    
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
      
      if (isUser && !trackedMessages.has(msgId + '_saved')) {
        const hasResponse = config.hasAssistantResponse(allMessages, idx);
        
        if (hasResponse) {
          trackedMessages.add(msgId + '_saved');
          newMessages.push({
            id: msgId,
            role: 'user',
            content: txt,
            summary: txt.slice(0, 60) + (txt.length > 60 ? '...' : ''),
            timestamp: new Date().toISOString(),
            index: idx
          });
          
          pendingUserMessages.delete(msgId);
        } else {
          if (!pendingUserMessages.has(msgId)) {
            pendingUserMessages.set(msgId, {
              content: txt,
              timestamp: Date.now(),
              index: idx
            });
          }
        }
      }
    });
    
    // Remove messages from storage that are still pending (no response after 5 seconds)
    const now = Date.now();
    const messagesToRemove = [];
    pendingUserMessages.forEach((msgData, msgId) => {
      if (now - msgData.timestamp > 5000) {
        messagesToRemove.push(msgId);
        trackedMessages.delete(msgId + '_saved');
      }
    });
    
    messagesToRemove.forEach(msgId => {
      pendingUserMessages.delete(msgId);
    });
    
    if (newMessages.length > 0) {
      await saveMessages(newMessages);
    }

    detectCurrentPosition();
  }

  async function rebuildConversation(allMessages) {
    // Clear all tracking
    trackedMessages.clear();
    messageElements.clear();
    messageContents.clear();
    pendingUserMessages.clear();
    
    // Build new message list from scratch based on what's visible
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
          trackedMessages.add(msgId + '_saved');
          messagesToSave.push({
            id: msgId,
            role: 'user',
            content: txt,
            summary: txt.slice(0, 60) + (txt.length > 60 ? '...' : ''),
            timestamp: new Date().toISOString(),
            index: idx
          });
        }
      }
    });
    
    // Replace entire conversation in storage
    const conversation = {
      url: window.location.href,
      title: document.title || `${platform} Chat`,
      createdAt: new Date().toISOString(),
      tabId: tabId,
      messages: messagesToSave
    };
    
    await chrome.storage.local.set({ [storageKey]: conversation });
    
    // Notify popup to refresh
    chrome.runtime.sendMessage({
      action: 'conversationRebuilt',
      storageKey: storageKey,
      tabId: tabId
    }).catch(() => {});
  }

  async function saveMessages(newMessages) {
    const result = await chrome.storage.local.get(storageKey);
    const conversation = result[storageKey] || {
      url: window.location.href,
      title: document.title || `${platform} Chat`,
      createdAt: new Date().toISOString(),
      tabId: tabId,
      messages: []
    };

    const existingIds = new Set(conversation.messages.map(m => m.id));
    
    newMessages.forEach(msg => {
      if (!existingIds.has(msg.id)) {
        conversation.messages.push(msg);
      }
    });

    await chrome.storage.local.set({ [storageKey]: conversation });
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 200); i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
    }
    return Math.abs(hash).toString(36);
  }

  async function forceLoadAllMessages() {
    const originalScrollY = window.scrollY;
    
    window.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 300));
    
    const docHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    
    const scrollSteps = 6;
    const stepSize = docHeight / scrollSteps;
    
    for (let i = 0; i <= scrollSteps; i++) {
      window.scrollTo({ top: stepSize * i, behavior: 'auto' });
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    window.scrollTo({ top: docHeight, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 300));
    
    window.scrollTo({ top: 0, behavior: 'auto' });
    await new Promise(resolve => setTimeout(resolve, 300));
    
    await captureMessages();
    
    return originalScrollY;
  }

  async function findAndScrollToMessage(messageId, targetContent) {
    let el = document.querySelector(`[data-tracked-id="${messageId}"]`);
    if (el && document.contains(el)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(msg);
        sendProgressUpdate(messageId);
        return true;
      }
    }
    
    await forceLoadAllMessages();
    
    el = document.querySelector(`[data-tracked-id="${messageId}"]`);
    if (el && document.contains(el)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightElement(el);
      sendProgressUpdate(messageId);
      return true;
    }
    
    const allMsgs = document.querySelectorAll(config.messageSelector);
    
    for (const msg of allMsgs) {
      const content = config.getContent(msg);
      const computedId = hashString(content + storageKey);
      
      if (computedId === messageId) {
        msg.dataset.trackedId = messageId;
        messageElements.set(messageId, msg);
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(msg);
        sendProgressUpdate(messageId);
        return true;
      }
      
      if (targetContent && content.includes(targetContent.substring(0, 50))) {
        msg.dataset.trackedId = messageId;
        messageElements.set(messageId, msg);
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(msg);
        sendProgressUpdate(messageId);
        return true;
      }
    }
    
    return false;
  }

  function sendProgressUpdate(messageId) {
    chrome.runtime.sendMessage({
      action: 'updateProgress',
      messageId: messageId,
      storageKey: storageKey,
      tabId: tabId
    });
  }

  function highlightElement(el) {
    const originalTransform = el.style.transform;
    el.style.transition = 'transform 0.2s ease';
    el.style.transform = 'scale(1.01)';
    
    setTimeout(() => {
      el.style.transform = originalTransform;
      setTimeout(() => {
        el.style.transition = '';
      }, 200);
    }, 200);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ success: true, ready: true, tabId: tabId });
      return true;
    }
    
    if (request.action === 'getTabId') {
      sendResponse({ tabId: tabId });
      return true;
    }
    
    if (request.action === 'getCurrentPosition') {
      const allMessages = document.querySelectorAll(config.messageSelector);
      if (allMessages.length === 0) {
        sendResponse({ messageId: null, tabId: tabId });
        return true;
      }
      
      const viewportCenter = window.innerHeight / 2;
      let closestMessage = null;
      let closestDistance = Infinity;
      
      allMessages.forEach(msg => {
        const rect = msg.getBoundingClientRect();
        const msgCenter = rect.top + rect.height / 2;
        const distance = Math.abs(msgCenter - viewportCenter);
        
        const msgId = msg.dataset.trackedId;
        if (msgId && distance < closestDistance) {
          closestDistance = distance;
          closestMessage = msgId;
        }
      });
      
      sendResponse({ messageId: closestMessage, tabId: tabId });
      return true;
    }
    
    if (request.action === 'scanNow') {
      captureMessages().then(() => {
        sendResponse({ success: true, tabId: tabId });
      });
      return true;
    }
    
    if (request.action === 'highlightMessage') {
      const targetContent = messageContents.get(request.messageId) || request.messageContent || '';
      
      findAndScrollToMessage(request.messageId, targetContent).then(success => {
        sendResponse({ success });
      }).catch(error => {
        sendResponse({ success: false });
      });
      
      return true;
    }
    
    return true;
  });
})();