import { runtime } from "@/shared/chrome";
import { defaults, getSettings, onSettingsChanged, type Settings } from "@/shared/storage";
import { FocusPingUi, type GentleInterventionPayload, type StrictInterventionPayload } from "./ui";

const CONTENT_NAMESPACE = "focus-ping-content";

console.debug(`[${CONTENT_NAMESPACE}] Loaded on`, window.location.hostname);

const ui = new FocusPingUi();
let currentSettings: Settings | null = null;

async function ensureSettings() {
  if (!currentSettings) {
    currentSettings = await getSettings();
  }
  return currentSettings;
}

onSettingsChanged((settings) => {
  currentSettings = settings;
});

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

async function openFocusTab() {
  await runtime.sendMessage({ type: "focus-ping::command-open-focus-tab" });
}

async function handleGentleIntervention(payload: GentleInterventionPayload) {
  const settings = await ensureSettings();
  const snoozeMinutes = Math.max(
    1,
    settings?.reminder.snoozeMinutes ?? defaults.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? defaults.settings.reminder.showGifs;

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
    settings?.reminder.snoozeMinutes ?? defaults.settings.reminder.snoozeMinutes,
  );
  const showGif = settings?.reminder.showGifs ?? defaults.settings.reminder.showGifs;

  await ui.showStrict(payload, {
    snoozeMinutes,
    showGif,
    onSnooze: () => snoozeDomain(payload.domain, snoozeMinutes),
    onOpenNewTab: () => openFocusTab(),
  });
}

chrome.runtime.onMessage.addListener((message) => {
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
