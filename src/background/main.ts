const EXTENSION_NAME = "Focus Ping";

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${EXTENSION_NAME} installed`);
  chrome.alarms.create("focus-ping::heartbeat", { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  console.info(`${EXTENSION_NAME} started`);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "focus-ping::heartbeat") {
    chrome.runtime.sendMessage({ type: "heartbeat" }).catch(() => {
      // No active listeners yet; safe to ignore.
    });
  }
});
