let currentConversation = null;
let currentUrl = "";

document.addEventListener("DOMContentLoaded", async () => {
  await loadCurrentConversation();
  setupEventListeners();
});

function getStorageKey(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash << 5) - hash + url.charCodeAt(i);
  }
  return "chat_" + Math.abs(hash).toString(36);
}

async function loadCurrentConversation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) { showError(); return; }

    currentUrl = tab.url;
    const supportedSites = ["chatgpt.com", "chat.openai.com", "claude.ai", "gemini.google.com", "copilot.microsoft.com"];
    if (!supportedSites.some(site => currentUrl.includes(site))) { showNotSupported(); return; }

    let contentScriptReady = false;
    try {
      const pingResponse = await chrome.tabs.sendMessage(tab.id, { action: "ping" });
      contentScriptReady = pingResponse?.ready;
    } catch (e) {}

    if (!contentScriptReady) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {}
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: "scanNow" });
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {}

    await loadMessages(getStorageKey(currentUrl));
  } catch (error) { showError(); }
}

async function loadMessages(key) {
  try {
    const result = await chrome.storage.local.get(key);
    currentConversation = result[key];
    renderMessages();
  } catch (error) { showError(); }
}

function renderMessages() {
  const content = document.getElementById("content");
  if (!content) return;

  if (!currentConversation || !currentConversation.messages || currentConversation.messages.length === 0) {
    content.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><div class="empty-text">No messages tracked yet.</div></div>`;
    updateProgressBar(0, 1);
    return;
  }

  try {
    const reversedMessages = [...currentConversation.messages].reverse();
    const grouped = groupMessagesByDate(reversedMessages);

    content.innerHTML = Object.entries(grouped).map(([date, messages]) => `
      <div class="date-group">
        ${messages.map(msg => `
          <div class="message-card ${msg.role}" data-message-id="${msg.id}" data-message-index="${msg.index || 0}">
            <div class="message-role-badge"></div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
          </div>
        `).join("")}
      </div>
    `).join("");

    const total = currentConversation.messages.length;

    content.querySelectorAll(".message-card").forEach(card => {
      card.addEventListener("click", () => {
        const msgId = card.dataset.messageId;
        const msgIdx = parseInt(card.dataset.messageIndex);
        document.querySelectorAll(".message-card").forEach(c => c.classList.remove("highlight"));
        card.classList.add("highlight");
        
        const actualIndex = currentConversation.messages.findIndex(m => m.id === msgId);
        updateProgressBar(actualIndex + 1, total);
        highlightMessageOnPage(msgId, msgIdx);
      });
    });

    // Default to end of chat (0%)
    updateProgressBar(total, total);
  } catch (error) { showError(); }
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

  // Adjusted Logic: Bottom of chat (currentMsg = totalMsgs) results in 0%
  const percentage = ((totalMsgs - currentMsg) / (totalMsgs - 1)) * 100;
  const clamped = Math.max(0, Math.min(100, percentage));

  const circumference = 150.8;
  const offset = circumference - (clamped / 100) * circumference;

  progressFill.style.strokeDashoffset = offset;
  progressText.textContent = Math.round(clamped) + "%";
  progressIndicator.classList.add("visible");
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

function showNotSupported() { document.getElementById("content").innerHTML = `<div class="empty-state">Not Supported</div>`; }
function showError() { document.getElementById("content").innerHTML = `<div class="empty-state">Error</div>`; }