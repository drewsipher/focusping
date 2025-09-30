import { runtime } from "@/shared/chrome";
import {
  getSessionState,
  getSettings,
  mutateSettings,
  type Settings,
  type SessionState,
} from "@/shared/storage";

const toggleButton = document.getElementById("toggle") as HTMLButtonElement | null;
const statusLabel = document.getElementById("status");
const modeLabel = document.getElementById("mode");
const reminderLabel = document.getElementById("reminder");
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement | null;

function updateUi(settings: Settings, session: SessionState) {
  if (statusLabel) {
    statusLabel.textContent = settings.paused ? "Monitoring paused" : "Staying focused";
  }

  if (modeLabel) {
    modeLabel.textContent = settings.mode === "strict" ? "Strict" : "Gentle";
  }

  if (reminderLabel) {
    reminderLabel.textContent = session.nextReminderInMinutes
      ? `${session.nextReminderInMinutes} min`
      : "--";
  }

  if (toggleButton) {
    toggleButton.textContent = settings.paused ? "Resume monitoring" : "Pause monitoring";
  }
}

async function refreshState() {
  const [settings, session] = await Promise.all([getSettings(), getSessionState()]);
  updateUi(settings, session);
}

async function togglePause() {
  const updated = await mutateSettings((settings) => ({
    ...settings,
    paused: !settings.paused,
  }));
  const session = await getSessionState();
  updateUi(updated, session);
  await runtime.sendMessage({
    type: "focus-ping::pause-toggled",
    payload: { paused: updated.paused },
  });
}

toggleButton?.addEventListener("click", () => {
  togglePause().catch(console.error);
});

openOptionsButton?.addEventListener("click", () => {
  runtime.openOptionsPage().catch(console.error);
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "focus-ping::state-updated") {
    refreshState().catch(console.error);
  }
});

refreshState().catch(console.error);
