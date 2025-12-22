let currentConversation = null;
let currentUrl = '';

document.addEventListener('DOMContentLoaded', async () => {
  await loadCurrentConversation();
  setupEventListeners();
});

function getStorageKey(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
  }
  return 'chat_' + Math.abs(hash).toString(36);
}

async function loadCurrentConversation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab || !tab.url) {
      showError();
      return;
    }
    
    currentUrl = tab.url;
    
    const supportedSites = [
      'chatgpt.com', 
      'chat.openai.com', 
      'claude.ai', 
      'gemini.google.com', 
      'copilot.microsoft.com'
    ];
    const isSupported = supportedSites.some(site => currentUrl.includes(site));
    
    if (!isSupported) {
      showNotSupported();
      return;
    }
    
    let contentScriptReady = false;
    try {
      const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
      contentScriptReady = pingResponse?.ready;
    } catch (e) {
      // Content script not loaded
    }
    
    if (!contentScriptReady) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        // Could not inject content script
      }
    }
    
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'scanNow' });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      // Could not trigger scan
    }
    
    const key = getStorageKey(currentUrl);
    await loadMessages(key);
    
  } catch (error) {
    showError();
  }
}

async function loadMessages(key) {
  try {
    const result = await chrome.storage.local.get(key);
    currentConversation = result[key];
    
    renderMessages();
  } catch (error) {
    showError();
  }
}

function renderMessages() {
  const content = document.getElementById('content');
  
  if (!content) {
    return;
  }
  
  if (!currentConversation || !currentConversation.messages || currentConversation.messages.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-text">
          No messages tracked yet on this page.<br>
          Start chatting and messages will appear here!
        </div>
      </div>
    `;
    return;
  }
  
  try {
    const reversedMessages = [...currentConversation.messages].reverse();
    const grouped = groupMessagesByDate(reversedMessages);
    
    const html = Object.entries(grouped).map(([date, messages]) => `
      <div class="date-group">
        <div class="date-header">${date}</div>
        ${messages.map(msg => `
          <div class="message-card ${msg.role}" 
               data-message-id="${msg.id}"
               data-message-index="${msg.index || 0}">
            <div class="message-role-badge">${msg.role === 'user' ? '👤 You' : '🤖 AI'}</div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
            <div class="message-time">${formatTime(new Date(msg.timestamp))}</div>
          </div>
        `).join('')}
      </div>
    `).join('');
    
    content.innerHTML = html;
    
    content.querySelectorAll('.message-card').forEach(card => {
      card.addEventListener('click', () => {
        const messageId = card.dataset.messageId;
        const messageIndex = parseInt(card.dataset.messageIndex) || 0;
        highlightMessageOnPage(messageId, messageIndex);
      });
    });
    
  } catch (error) {
    showError();
  }
}

function groupMessagesByDate(messages) {
  const grouped = {};
  
  messages.forEach(msg => {
    const date = new Date(msg.timestamp).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
    
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(msg);
  });
  
  return grouped;
}

function setupEventListeners() {
  const searchInput = document.getElementById('search-input');
  searchInput?.addEventListener('input', handleSearch);
}

function handleSearch(e) {
  const query = e.target.value.toLowerCase().trim();
  
  if (!currentConversation || !currentConversation.messages) return;
  
  const cards = document.querySelectorAll('.message-card');
  
  if (!query) {
    cards.forEach(card => card.style.display = 'block');
    return;
  }
  
  cards.forEach(card => {
    const content = card.querySelector('.message-content').textContent.toLowerCase();
    if (content.includes(query)) {
      card.style.display = 'block';
      const contentEl = card.querySelector('.message-content');
      const text = contentEl.textContent;
      const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
      const highlighted = text.replace(regex, '<mark>$1</mark>');
      contentEl.innerHTML = highlighted;
    } else {
      card.style.display = 'none';
    }
  });
}

async function highlightMessageOnPage(messageId, messageIndex) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const card = document.querySelector(`[data-message-id="${messageId}"]`);
    let messageContent = '';
    
    if (card) {
      card.style.opacity = '0.6';
      card.style.transform = 'scale(0.98)';
      messageContent = card.querySelector('.message-content')?.textContent || '';
    }
    
    const message = currentConversation?.messages?.find(m => m.id === messageId);
    if (message) {
      messageContent = message.content;
    }
    
    const loadingNotif = showNotification('🔄 Scrolling to message...', 0);
    
    const response = await chrome.tabs.sendMessage(tab.id, { 
      action: 'highlightMessage', 
      messageId: messageId,
      messageIndex: messageIndex,
      messageContent: messageContent
    });
    
    if (loadingNotif) loadingNotif.remove();
    
    if (card) {
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
    }
    
    if (response && response.success) {
      showNotification('✅ Message found!', 2000);
    } else {
      showNotification('❌ Message not found. It may have been deleted.', 3000);
    }
    
  } catch (error) {
    showNotification('❌ Could not scroll to message', 3000);
  }
}

function showNotification(message, duration = 3000) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    background: #333;
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 12px;
    z-index: 10000;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  notification.textContent = message;
  document.body.appendChild(notification);
  
  if (duration > 0) {
    setTimeout(() => {
      notification.remove();
    }, duration);
  }
  
  return notification;
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function showNotSupported() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-text">
        This page is not supported.<br><br>
        <strong>Supported sites:</strong><br>
        • ChatGPT (chat.openai.com)<br>
        • Claude (claude.ai)<br>
        • Gemini (gemini.google.com)<br>
        • Copilot (copilot.microsoft.com)
      </div>
    </div>
  `;
}

function showError() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <div class="empty-text">
        Error loading conversation.<br>Please try again.
      </div>
    </div>
  `;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && currentUrl) {
    const key = getStorageKey(currentUrl);
    if (changes[key]) {
      loadMessages(key);
    }
  }
});