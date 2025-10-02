import { FocusPingUi, type GentleInterventionPayload, type StrictInterventionPayload } from "./ui";

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

const ui = new FocusPingUi();

// Dismiss now just closes the toast with no timer
async function dismissGentle(domain: string) {
  await runtime.sendMessage({
    type: "focusping::command-snooze",
    payload: { domain, minutes: 0 },
  });
}

// Snooze now restarts the timer (old dismiss behavior)
async function snoozeWithTimer(domain: string) {
  await runtime.sendMessage({
    type: "focusping::command-dismiss-gentle",
    payload: { domain },
  });
}

async function handleGentleIntervention(payload: GentleInterventionPayload) {
  console.log("🎯 [CONTENT] handleGentleIntervention called", payload.domain);
  const reminderMinutes = payload.reminderMinutes;
  const showGif = payload.showGif;

  await ui.showGentle(payload, {
    reminderMinutes,
    showGif,
    onDismiss: () => dismissGentle(payload.domain),
    onSnooze: () => snoozeWithTimer(payload.domain),
  });
  console.log("✅ [CONTENT] handleGentleIntervention completed");
}

async function handleStrictIntervention(payload: StrictInterventionPayload) {
  const reminderMinutes = payload.reminderMinutes;
  const showGif = payload.showGif;

  await ui.showStrict(payload, {
    reminderMinutes,
    showGif,
    onSnooze: () => snoozeWithTimer(payload.domain),
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
