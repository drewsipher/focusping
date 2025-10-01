import { FocusPingUi, type GentleInterventionPayload, type StrictInterventionPayload } from "./ui";

const CONTENT_NAMESPACE = "focusping-content";

type RuntimeMessage = Record<string, unknown>;
const runtime = {
  sendMessage: (message: RuntimeMessage) =>
    new Promise((resolve, reject) => {
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

// onSettingsChanged is intentionally a noop in the content script environment
// content scripts don't track settings changes via this module in the current build

void ensureSettings().catch((error) => {
  console.error(`[${CONTENT_NAMESPACE}] Failed to load settings`, error);
});

async function dismissGentle(domain: string) {
  await runtime.sendMessage({
    type: "focusping::command-dismiss-gentle",
    payload: { domain },
  });
}

async function snoozeDomain(domain: string, minutes: number) {
  await runtime.sendMessage({
    type: "focusping::command-snooze",
    payload: { domain, minutes },
  });
}

async function handleGentleIntervention(payload: GentleInterventionPayload) {
  const settings = await ensureSettings();
  const snoozeMinutes = Math.max(
    1,
    settings?.reminder.snoozeMinutes ?? p.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? p.settings.reminder.showGifs;

  await ui.showGentle(payload, {
    snoozeMinutes,
    showGif,
    onDismiss: () => dismissGentle(payload.domain),
    onSnooze: () => snoozeDomain(payload.domain, snoozeMinutes),
  });
}

async function handleStrictIntervention(payload: StrictInterventionPayload) {
  const settings = await ensureSettings();
  const snoozeMinutes = Math.max(
    1,
    settings?.reminder.snoozeMinutes ?? p.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? p.settings.reminder.showGifs;

  await ui.showStrict(payload, {
    snoozeMinutes,
    showGif,
    onSnooze: () => snoozeDomain(payload.domain, snoozeMinutes),
  });
}

chrome.runtime.onMessage.addListener((message) => {
  // received message
  if (!message?.type) {
    return;
  }

  if (message.type === "focusping::gentle-intervention") {
    void handleGentleIntervention(message.payload as GentleInterventionPayload);
    return;
  }

  if (message.type === "focusping::strict-intervention") {
    void handleStrictIntervention(message.payload as StrictInterventionPayload);
    return;
  }

  if (message.type === "focusping::clear-intervention") {
    ui.clear();
    return;
  }

  if (message.type === "heartbeat") {
    // heartbeat received
  }
});

// Notify background that the content script is present in this tab. Fire-and-forget
// so we don't await a response (background may not send one), which avoids the
// "message port closed before a response was received" rejection in some cases.
try {
  chrome.runtime.sendMessage({ type: "focusping::content-ready" }, () => {
    // intentionally empty callback to avoid leaving the message port open
  });
} catch (e) {
  // best-effort — ignore any synchronous errors
}
