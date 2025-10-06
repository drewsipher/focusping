import { rename } from "fs";
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

async function dismissGentle(domain: string) {
  await runtime.sendMessage({
    type: "focusping::command-snooze",
    payload: { domain, minutes: 0 },
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
  const reminderMinutes = payload.reminderMinutes;
  const showGif = payload.showGif;

  await ui.showGentle(payload, {
    reminderMinutes,
    showGif,
    onDismiss: () => dismissGentle(payload.domain),
    onSnooze: () => snoozeDomain(payload.domain, reminderMinutes),
  });
  console.log("✅ [CONTENT] handleGentleIntervention completed");
}

async function handleStrictIntervention(payload: StrictInterventionPayload) {
  const reminderMinutes = payload.reminderMinutes;
  const showGif = payload.showGif;

  await ui.showStrict(payload, {
    reminderMinutes,
    showGif,
    onSnooze: () => snoozeDomain(payload.domain, reminderMinutes),
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log("[CONTENT] Message received:", message?.type);

  if (!message?.type) {
    return;
  }

  if (message.type === "focusping::gentle-intervention") {
    console.log("[CONTENT] gentle intervention message");
    void handleGentleIntervention(message.payload as GentleInterventionPayload)
      .then(() => {
        sendResponse({ ok: true });
      })
      .catch((err) => {
        console.log("[CONTENT] ERROR - Gentle intervention failed:", err);
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (message.type === "focusping::strict-intervention") {
    console.log("[CONTENT] strict intervention message");
    void handleStrictIntervention(message.payload as StrictInterventionPayload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message.type === "focusping::clear-intervention") {
    ui.clear();
    sendResponse({ ok: true });
    return true;
  }
});

// Notify background that the content script is present in this tab. Fire-and-forget
// so we don't await a response (background may not send one), which avoids the
// "message port closed before a response was received" rejection in some cases.
try {
  chrome.runtime.sendMessage({ type: "focusping::content-ready" }, () => {});
} catch (e) {
  console.error("[CONTENT] Error notifying background:", e);
}
