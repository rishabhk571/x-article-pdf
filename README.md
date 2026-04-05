# X Article to PDF Extension

A focused, privacy-first Manifest V3 browser extension that converts X (Twitter) longform articles into clean, typographic local PDFs. 

## Features
* **Zero Dependencies:** Runs entirely on-device without remote APIs, backend scraping, or database storage.
* **Privacy First:** No user data tracking, no `chrome.storage`, and no remote execution.
* **Smart Extraction:** Automatically handles DraftJS lazy-loading, forcing DOM hydration before extraction using randomized scroll heuristics.
* **Typographic Preservation:** Converts raw DOM nodes into structured PDF blocks (headings, blockquotes, lists, code blocks) using a locally bundled `jsPDF` engine.

## Architecture
This extension coordinates three browser execution realms:
1. **Popup (Operator Console):** Manages UI state, orchestrates the export pipeline, and renders the final PDF locally on the main thread.
2. **Content Script (Field Worker):** Injected directly into the X page to manage scrolling, observe DOM mutations, and parse structured text blocks.
3. **Service Worker (Switchboard):** A lightweight background relay forwarding telemetry (PROGRESS events) from the content script to the popup via long-lived ports.

## Installation (Developer Mode)
1. Clone this repository or download the source code.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** and select the extension directory.

## Technical Stack
* Manifest V3
* Vanilla JavaScript (ES6+)
* `jsPDF` (Bundled locally)

## License
Distributed under the MIT License.
