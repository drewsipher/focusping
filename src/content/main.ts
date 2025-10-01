console.log("Content script loaded on", window.location.hostname);

import { FocusPingUi, type GentleInterventionPayload, type StrictInterventionPayload } from "./ui";

const CONTENT_NAMESPACE = "focus-ping-content";

console.debug(`[${CONTENT_NAMESPACE}] Loaded on`, window.location.hostname);

const runtime = {
  sendMessage: (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  }),
};

const p = {
  settings: {
    reminder: {
      snoozeMinutes: 10,
      showGifs: true,
    },
  },
};

const ui = new FocusPingUi();
let currentSettings = null;

async function ensureSettings() {
  if (!currentSettings) {
    currentSettings = p.settings;
  }
  return currentSettings;
}

function onSettingsChanged(listener) {
  // do nothing
}

void ensureSettings().catch((error) => {
  console.error(`[${CONTENT_NAMESPACE}] Failed to load settings`, error);
});

async function dismissGentle(domain: string) {
  await runtime.sendMessage({
    type: "focus-ping::command-dismiss-gentle",
    payload: { domain },
  });
}

async function snoozeDomain(domain: string, minutes: number) {
  await runtime.sendMessage({
    type: "focus-ping::command-snooze",
    payload: { domain, minutes },
  });
}

async function handleGentleIntervention(payload: GentleInterventionPayload) {
  console.log(`[${CONTENT_NAMESPACE}] Handling gentle intervention`, payload);
  const settings = await ensureSettings();
  const snoozeMinutes = Math.max(
    1,
    settings?.reminder.snoozeMinutes ?? p.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? p.settings.reminder.showGifs;

  console.log(`[${CONTENT_NAMESPACE}] Showing gentle toast`);
  await ui.showGentle(payload, {
    snoozeMinutes,
    showGif,
    onDismiss: () => dismissGentle(payload.domain),
    onSnooze: () => snoozeDomain(payload.domain, snoozeMinutes),
  });
}

async function handleStrictIntervention(payload: StrictInterventionPayload) {
  console.log(`[${CONTENT_NAMESPACE}] Handling strict intervention`, payload);
  const settings = await ensureSettings();
  const snoozeMinutes = Math.max(
    1,
    settings?.reminder.snoozeMinutes ?? p.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? p.settings.reminder.showGifs;

  console.log(`[${CONTENT_NAMESPACE}] Showing strict overlay`);
  await ui.showStrict(payload, {
    snoozeMinutes,
    showGif,
    onSnooze: () => snoozeDomain(payload.domain, snoozeMinutes),
  });
}

chrome.runtime.onMessage.addListener((message) => {
  console.log(`[${CONTENT_NAMESPACE}] Received message:`, message?.type);
  if (!message?.type) {
    return;
  }

  if (message.type === "focus-ping::gentle-intervention") {
    void handleGentleIntervention(message.payload as GentleInterventionPayload);
    return;
  }

  if (message.type === "focus-ping::strict-intervention") {
    void handleStrictIntervention(message.payload as StrictInterventionPayload);
    return;
  }

  if (message.type === "focus-ping::clear-intervention") {
    ui.clear();
    return;
  }

  if (message.type === "heartbeat") {
    console.debug(`[${CONTENT_NAMESPACE}] Heartbeat received`);
  }
});
