(function() {
  let trackedMessages = new Set();
  let messageElements = new Map();
  let messageContents = new Map();
  let lastMessageCount = 0;
  let currentUrl = window.location.href;
  
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
      getContent: (el) => {
        const userMsg = el.querySelector('[data-testid="user-message"]');
        if (userMsg) return userMsg.textContent.trim();
        return el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        return userMessageIndex < allMessages.length - 1;
      }
    },
    'chat.openai.com': {
      messageSelector: '[data-message-author-role]',
      isUserMessage: (el) => el.getAttribute('data-message-author-role') === 'user',
      getContent: (el) => {
        const markdown = el.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap');
        return markdown ? markdown.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        return userMessageIndex < allMessages.length - 1;
      }
    },
    'chatgpt.com': {
      messageSelector: '[data-message-author-role]',
      isUserMessage: (el) => el.getAttribute('data-message-author-role') === 'user',
      getContent: (el) => {
        const markdown = el.querySelector('.markdown, [data-message-content], .whitespace-pre-wrap');
        return markdown ? markdown.textContent.trim() : el.textContent.trim();
      },
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        return userMessageIndex < allMessages.length - 1;
      }
    },
    'gemini.google.com': {
      messageSelector: 'user-query, model-response',
      isUserMessage: (el) => el.tagName.toLowerCase() === 'user-query',
      getContent: (el) => el.textContent.trim(),
      hasAssistantResponse: (allMessages, userMessageIndex) => {
        return userMessageIndex < allMessages.length - 1;
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
  
  function getStorageKey(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
    }
    return 'chat_' + Math.abs(hash).toString(36);
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
      lastMessageCount = 0;
    }
  }

  setInterval(checkUrlChange, 1000);
  setTimeout(captureMessages, 1000);
  setInterval(captureMessages, 3000);

  async function captureMessages() {
    checkUrlChange();
    
    const msgs = document.querySelectorAll(config.messageSelector);
    
    if (msgs.length !== lastMessageCount) {
      lastMessageCount = msgs.length;
    }
    
    const newMessages = [];
    const allMessages = Array.from(msgs);
    
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
        trackedMessages.add(msgId + '_saved');
        const hasResponse = config.hasAssistantResponse(allMessages, idx);
        
        if (hasResponse) {
          newMessages.push({
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
    
    if (newMessages.length > 0) {
      await saveMessages(newMessages);
    }
  }

  async function saveMessages(newMessages) {
    const result = await chrome.storage.local.get(storageKey);
    const conversation = result[storageKey] || {
      url: window.location.href,
      title: document.title || `${platform} Chat`,
      createdAt: new Date().toISOString(),
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
        return true;
      }
    }
    
    await forceLoadAllMessages();
    
    el = document.querySelector(`[data-tracked-id="${messageId}"]`);
    if (el && document.contains(el)) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      highlightElement(el);
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
        return true;
      }
      
      if (targetContent && content.includes(targetContent.substring(0, 50))) {
        msg.dataset.trackedId = messageId;
        messageElements.set(messageId, msg);
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(msg);
        return true;
      }
    }
    
    return false;
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
      sendResponse({ success: true, ready: true });
      return true;
    }
    
    if (request.action === 'scanNow') {
      captureMessages().then(() => {
        sendResponse({ success: true });
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