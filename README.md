# AI Chat History Navigator

A Chrome extension that tracks chat history across AI platforms
(ChatGPT, Claude, Gemini, Copilot) and allows instant navigation
to any past message without manual scrolling.

## Features
- Tracks user messages per conversation
- Works across multiple AI chat platforms
- Searchable message index
- One-click jump to any message
- Persistent local storage (per URL)

## How It Works
- `content.js` observes and stores chat messages
- `popup.js` renders a searchable navigation panel
- Messages are identified via stable content hashes
- Clicking a message scrolls to it inside the chat UI

## Supported Platforms
- chatgpt.com
- chat.openai.com
- claude.ai
- gemini.google.com
- copilot.microsoft.com

## Installation
1. Clone the repo
2. Open Chrome → Extensions → Enable Developer Mode
3. Load unpacked → Select this folder

## Status
Active development 🚧
