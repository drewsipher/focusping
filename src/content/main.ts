const CONTENT_NAMESPACE = "focus-ping-content";

console.debug(`[${CONTENT_NAMESPACE}] Loaded on`, window.location.hostname);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "heartbeat") {
    // Placeholder for future site detection and UI injection.
    console.debug(`[${CONTENT_NAMESPACE}] Heartbeat received`);
  }
});
