let currentConversation = null;
let currentUrl = "";
let currentTabId = null;
let isUserScrolling = false;
let scrollTimeout = null;

document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentConversation();
  setupEventListeners();
  setTimeout(requestCurrentPosition, 100);
});

function getStorageKey(url, tabId) {
  const urlObj = new URL(url);
  const pathParts = urlObj.pathname.split('/').filter(p => p.length > 0);
  
  let uniquePart = urlObj.pathname;
  if (pathParts.length > 0) {
    uniquePart = pathParts[pathParts.length - 1];
  }
  
  let hash = 0;
  const fullString = uniquePart + urlObj.search;
  for (let i = 0; i < fullString.length; i++) {
    hash = (hash << 5) - hash + fullString.charCodeAt(i);
  }
  
  return "chat_" + Math.abs(hash).toString(36) + '_' + tabId;
}

async function requestCurrentPosition() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    const response = await chrome.tabs.sendMessage(tab.id, { action: "getCurrentPosition" });
    if (response && response.messageId && response.tabId && currentConversation) {
      if (response.tabId === currentTabId) {
        const idx = currentConversation.messages.findIndex(m => m.id === response.messageId);
        if (idx !== -1) {
          updateProgressBar(idx + 1, currentConversation.messages.length);
          highlightMessageCard(response.messageId);
        }
      }
    }
  } catch (e) {
    setTimeout(async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        const response = await chrome.tabs.sendMessage(tab.id, { action: "getCurrentPosition" });
        if (response && response.messageId && response.tabId && currentConversation) {
          if (response.tabId === currentTabId) {
            const idx = currentConversation.messages.findIndex(m => m.id === response.messageId);
            if (idx !== -1) {
              updateProgressBar(idx + 1, currentConversation.messages.length);
              highlightMessageCard(response.messageId);
            }
          }
        }
      } catch (retryError) {}
    }, 300);
  }
}

async function loadCurrentConversation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { showError(); return; }

    currentUrl = tab.url;
    const supportedSites = ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com"];
    if (!supportedSites.some(site => currentUrl.includes(site))) { showNotSupported(); return; }

    let contentScriptReady = false;
    let tabIdResponse = null;
    
    try {
      const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      contentScriptReady = pingResponse?.ready;
      tabIdResponse = pingResponse?.tabId;
    } catch (e) {}

    if (!contentScriptReady) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        try {
          const response = await chrome.tabs.sendMessage(tab.id, { action: "getTabId" });
          tabIdResponse = response?.tabId;
        } catch (e) {}
      } catch (e) {}
    }

    currentTabId = tabIdResponse;
    
    if (!currentTabId) {
      showError();
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: "scanNow" });
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (e) {}

    await loadMessages(getStorageKey(currentUrl, currentTabId));
  } catch (error) { 
    console.error('Load error:', error);
    showError(); 
  }
}

async function loadMessages(key) {
  try {
    const result = await chrome.storage.local.get(key);
    currentConversation = result[key];
    
    if (currentConversation && currentConversation.tabId !== currentTabId) {
      currentConversation = null;
    }
    
    renderMessages();
  } catch (error) { 
    console.error('Load messages error:', error);
    showError(); 
  }
}

function renderMessages() {
  const content = document.getElementById("content");
  if (!content) return;
  
  if (!currentConversation?.messages || currentConversation.messages.length === 0) {
    content.innerHTML = '<div class="empty-state">No messages captured yet</div>';
    return;
  }
  
  const reversed = [...currentConversation.messages].reverse();
  
  content.innerHTML = reversed.map(msg => `
    <div class="message-card" data-message-id="${msg.id}">
      <svg class="card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
      </svg>
      <div class="message-content">${msg.content.replace(/</g, "&lt;")}</div>
    </div>
  `).join("");

  content.querySelectorAll(".message-card").forEach(card => {
    card.addEventListener("click", () => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.tabs.sendMessage(tab.id, { action: "highlightMessage", messageId: card.dataset.messageId });
      });
    });
  });
  
  // Initialize progress bar
  updateProgressBar(currentConversation.messages.length, currentConversation.messages.length);
}

function updateProgressBar(currentMsg, totalMsgs) {
  const progressFill = document.querySelector(".progress-fill");
  const progressText = document.getElementById("progress-text");
  const progressIndicator = document.getElementById("progress-indicator");

  if (!progressFill || !progressText || !progressIndicator) return;

  if (totalMsgs <= 1) {
    progressIndicator.classList.remove("visible");
    return;
  }

  
  const messageIndex = currentMsg - 1;
  const percentage = ((totalMsgs - 1 - messageIndex) / (totalMsgs - 1)) * 100;
  const clamped = Math.max(0, Math.min(100, percentage));

  const circumference = 150.8;
  const offset = circumference - (clamped / 100) * circumference;

  requestAnimationFrame(() => {
    progressFill.style.strokeDashoffset = offset;
    progressText.textContent = Math.round(clamped) + "%";
    progressIndicator.classList.add("visible");
  });
}

function highlightMessageCard(messageId) {
  requestAnimationFrame(() => {
    document.querySelectorAll(".message-card").forEach(c => c.classList.remove("highlight"));
    
    const activeCard = document.querySelector(`[data-message-id="${messageId}"]`);
    if (activeCard) {
      activeCard.classList.add("highlight");
      
      if (isUserScrolling) {
        return;
      }
      
      const content = document.getElementById("content");
      if (content) {
        const cardRect = activeCard.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        
        // Check if card is fully visible within content area
        const isVisible = (
          cardRect.top >= contentRect.top &&
          cardRect.bottom <= contentRect.bottom
        );
        
        if (!isVisible) {
          activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  });
}

function groupMessagesByDate(messages) {
  const grouped = {};
  messages.forEach(msg => {
    const date = new Date(msg.timestamp).toLocaleDateString();
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(msg);
  });
  return grouped;
}

function setupEventListeners() {
  document.getElementById("search-input")?.addEventListener("input", handleSearch);
  document.getElementById("progress-indicator")?.addEventListener("click", () => {
    const content = document.getElementById("content");
    content.scrollTo({ top: content.scrollTop > 100 ? 0 : content.scrollHeight, behavior: "smooth" });
  });
  
  const content = document.getElementById("content");
  if (content) {
    content.addEventListener("scroll", () => {
      isUserScrolling = true;
      
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      
      scrollTimeout = setTimeout(() => {
        isUserScrolling = false;
      }, 2000);
    }, { passive: true });
    
    content.addEventListener("wheel", () => {
      isUserScrolling = true;
      
      if (scrollTimeout) {
        clearTimeout(scrollTimeout);
      }
      
      scrollTimeout = setTimeout(() => {
        isUserScrolling = false;
      }, 2000);
    }, { passive: true });
  }
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  const cards = document.querySelectorAll(".message-card");
  cards.forEach(card => {
    const text = card.querySelector(".message-content").textContent.toLowerCase();
    card.style.display = text.includes(query) ? "block" : "none";
  });
}

async function highlightMessageOnPage(messageId, messageIndex) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, {
    action: "highlightMessage",
    messageId: messageId,
    messageIndex: messageIndex
  });
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showNotSupported() { 
  document.getElementById("content").innerHTML = `<div class="empty-state">Not Supported</div>`; 
}

function showError() { 
  document.getElementById("content").innerHTML = `<div class="empty-state">Error loading conversation</div>`; 
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "updateProgress") {
    if (request.tabId !== currentTabId) {
      sendResponse({ success: false, reason: 'wrong_tab' });
      return true;
    }
    
    const storageKey = getStorageKey(currentUrl, currentTabId);
    if (request.storageKey === storageKey && currentConversation && currentConversation.messages) {
      const total = currentConversation.messages.length;
      const idx = currentConversation.messages.findIndex(m => m.id === request.messageId);

      if (idx !== -1) {
        updateProgressBar(idx + 1, total);
        
        highlightMessageCard(request.messageId);
      }
    }
    sendResponse({ success: true });
  }
  
  if (request.action === "conversationRebuilt") {
    if (request.tabId === currentTabId) {
      const storageKey = getStorageKey(currentUrl, currentTabId);
      if (request.storageKey === storageKey) {
        loadMessages(storageKey);
      }
    }
    sendResponse({ success: true });
  }
  
  return true;
});