const toggleButton = document.getElementById("toggle") as HTMLButtonElement | null;
const statusLabel = document.getElementById("status");
const modeLabel = document.getElementById("mode");
const reminderLabel = document.getElementById("reminder");
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement | null;

async function refreshState() {
  const settings = await chrome.storage.sync.get({
    paused: false,
    mode: "gentle",
    nextReminderInMinutes: null as number | null,
  });

  if (statusLabel) {
    statusLabel.textContent = settings.paused ? "Monitoring paused" : "Staying focused";
  }

  if (modeLabel) {
    modeLabel.textContent = settings.mode === "strict" ? "Strict" : "Gentle";
  }

  if (reminderLabel) {
    reminderLabel.textContent = settings.nextReminderInMinutes
      ? `${settings.nextReminderInMinutes} min`
      : "--";
  }

  if (toggleButton) {
    toggleButton.textContent = settings.paused ? "Resume monitoring" : "Pause monitoring";
  }
}

async function togglePause() {
  const current = await chrome.storage.sync.get({ paused: false });
  const paused = !current.paused;
  await chrome.storage.sync.set({ paused });
  await refreshState();
  chrome.runtime.sendMessage({
    type: "focus-ping::pause-toggled",
    payload: { paused },
  });
}

if (toggleButton) {
  toggleButton.addEventListener("click", togglePause);
}

openOptionsButton?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "focus-ping::state-updated") {
    refreshState().catch(console.error);
  }
});

refreshState().catch(console.error);
