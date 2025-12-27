// Background service worker
chrome.runtime.onInstalled.addListener(() => {
  // Extension installed
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const supportedSites = [
      'chat.openai.com',
      'claude.ai',
      'gemini.google.com',
      'copilot.microsoft.com'
    ];
    
    if (supportedSites.some(site => tab.url.includes(site))) {
      // Supported site detected
    }
  }
});