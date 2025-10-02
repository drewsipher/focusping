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
  console.log("🎯 [CONTENT] handleGentleIntervention called", payload.domain);
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
  console.log("✅ [CONTENT] handleGentleIntervention completed");
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("📬 [CONTENT] Message received:", message?.type);

  // received message
  if (!message?.type) {
    return;
  }

  if (message.type === "focusping::gentle-intervention") {
    console.log("🎯 [CONTENT] Handling gentle intervention message");
    void handleGentleIntervention(message.payload as GentleInterventionPayload)
      .then(() => {
        console.log("✅ [CONTENT] Gentle intervention handled, sending response");
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.log("❌ [CONTENT] Gentle intervention failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // Keep message port open for async response
  }

  if (message.type === "focusping::strict-intervention") {
    void handleStrictIntervention(message.payload as StrictInterventionPayload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // Keep message port open for async response
  }

  if (message.type === "focusping::clear-intervention") {
    ui.clear();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "heartbeat") {
    // heartbeat received
    sendResponse({ ok: true });
    return true;
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
