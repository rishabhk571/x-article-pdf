/**
 * background.js  –  Manifest V3 Service Worker
 *
 * Responsibilities:
 *   • Injects content.js on demand into tabs that are NOT on /i/articles/* paths
 *     (the manifest content_script handles automatic injection for those URLs,
 *      but if the user opened the popup on a non-matching tab this acts as a
 *      safety net that returns a friendly error).
 *   • Relays PROGRESS messages from content.js to the popup (needed because
 *     MV3 service workers bridge messages between isolated worlds).
 */

// Keep a reference to the popup port so we can forward progress updates.
let popupPort = null;

/**
 * Long-lived connection from popup.js.
 * popup.js calls chrome.runtime.connect({ name: 'popup' }) on load.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPort = port;
    port.onDisconnect.addListener(() => { popupPort = null; });
  }
});

/**
 * Short-lived messages from content.js (PROGRESS events).
 * Forward them to the popup if it is open.
 */
chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
  if (message.action === 'PROGRESS' && popupPort) {
    try {
      popupPort.postMessage(message);
    } catch (_) {
      // Popup may have closed; ignore the error.
    }
  }
  // Do NOT return true here – we have no async sendResponse.
});
