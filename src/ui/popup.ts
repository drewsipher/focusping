import { DateTime } from "luxon";
import { runtime } from "@/shared/chrome";
import { computeFocusWindow, type FocusStatus } from "@/shared/focus-window";
import type { FocusState } from "@/shared/focus-state";
import {
  getSessionState,
  getSettings,
  mutateSettings,
  type Mode,
  type Settings,
  type SessionState,
} from "@/shared/storage";

const toggleButton = document.getElementById("toggle") as HTMLButtonElement | null;
const statusBadge = document.getElementById("status-badge") as HTMLSpanElement | null;
const statusHeadline = document.getElementById("status-headline") as HTMLParagraphElement | null;
const reminderLabel = document.getElementById("reminder-countdown") as HTMLElement | null;
const scheduleSummary = document.getElementById("schedule-summary") as HTMLElement | null;
const nextTransitionLabel = document.getElementById("next-transition") as HTMLElement | null;
const openOptionsButton = document.getElementById("open-options") as HTMLButtonElement | null;
const testGentleButton = document.getElementById("test-gentle") as HTMLButtonElement | null;
const testStrictButton = document.getElementById("test-strict") as HTMLButtonElement | null;
const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']"));

type DisplayStatus = FocusStatus | "loading";

const STATUS_COPY: Record<DisplayStatus, { badge: string; headline: string }> = {
  loading: { badge: "Loading", headline: "Checking your focus…" },
  active: { badge: "Focusing", headline: "Monitoring your tabs" },
  "manually-paused": { badge: "Paused", headline: "Monitoring paused" },
  "outside-schedule": { badge: "Idle", headline: "Outside focus hours" },
  snoozed: { badge: "Snoozed", headline: "Enjoy the quick break" },
};

let settingsCache: Settings | null = null;
let sessionCache: SessionState | null = null;
let focusStateCache: FocusState | null = null;
let updatingMode = false;

function deriveStatus(settings: Settings | null, focusState: FocusState | null): DisplayStatus {
  if (!settings) {
    return "loading";
  }

  if (focusState) {
    return focusState.status;
  }

  return settings.paused ? "manually-paused" : "active";
}

function updateStatus() {
  const statusKey = deriveStatus(settingsCache, focusStateCache);
  const copy = STATUS_COPY[statusKey];

  if (statusBadge) {
    statusBadge.textContent = copy.badge;
    statusBadge.dataset.status = statusKey;
  }

  if (statusHeadline) {
    statusHeadline.textContent = copy.headline;
  }

  if (toggleButton) {
    const paused = settingsCache?.paused ?? false;
    toggleButton.textContent = paused ? "Resume monitoring" : "Pause monitoring";
  }
}

function updateReminder() {
  if (!reminderLabel) {
    return;
  }

  const minutes = sessionCache?.nextReminderInMinutes;
  reminderLabel.textContent = minutes ? `${minutes} min` : "--";
}

function updateModeControls() {
  if (!settingsCache) {
    return;
  }

  modeInputs.forEach((input) => {
    input.checked = input.value === settingsCache?.mode;
    input.disabled = updatingMode;
  });
}

function formatDurationMinutes(diffMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(diffMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours && minutes) {
    return `${hours}h ${minutes}m`;
  }

  if (hours) {
    return `${hours}h`;
  }

  return `${safeMinutes} min`;
}

function updateSchedule() {
  if (!scheduleSummary || !nextTransitionLabel || !settingsCache) {
    return;
  }

  const window = computeFocusWindow(settingsCache, DateTime.utc());
  const timezone =
    focusStateCache?.timezone || window.start.zoneName || settingsCache.schedule.timezone;
  const start = (
    focusStateCache ? DateTime.fromISO(focusStateCache.windowStartIso) : window.start
  ).setZone(timezone);
  const end = (
    focusStateCache ? DateTime.fromISO(focusStateCache.windowEndIso) : window.end
  ).setZone(timezone);

  scheduleSummary.textContent = `${start.toFormat("HH:mm")} – ${end.toFormat("HH:mm")} (${timezone})`;

  const nextTransitionIso = focusStateCache?.nextTransitionIso;
  const nextTransitionFallback = window.isWithinWindow ? window.end : window.start;
  const nextTransition = (
    nextTransitionIso ? DateTime.fromISO(nextTransitionIso) : nextTransitionFallback
  ).setZone(timezone);

  const now = DateTime.utc().setZone(timezone);
  const diff = nextTransition.diff(now, "minutes").minutes ?? 0;
  const duration = formatDurationMinutes(diff);

  const activeStatus = deriveStatus(settingsCache, focusStateCache);
  const prefix = activeStatus === "active" ? "Focus ends in" : "Focus resumes in";

  nextTransitionLabel.textContent = `${prefix} ${duration} (${nextTransition.toFormat("HH:mm")})`;
}

function updateUi() {
  updateStatus();
  updateReminder();
  updateModeControls();
  updateSchedule();
}

async function refreshState() {
  const [settings, session] = await Promise.all([getSettings(), getSessionState()]);
  settingsCache = settings;
  sessionCache = session;
  updateUi();
}

async function togglePause() {
  if (!settingsCache) {
    return;
  }

  const updated = await mutateSettings((settings) => ({
    ...settings,
    paused: !settings.paused,
  }));
  settingsCache = updated;
  const session = await getSessionState();
  sessionCache = session;
  updateUi();
  await runtime.sendMessage({
    type: "focus-ping::pause-toggled",
    payload: { paused: updated.paused },
  });
}

async function setMode(nextMode: Mode) {
  if (!settingsCache || settingsCache.mode === nextMode || updatingMode) {
    return;
  }

  updatingMode = true;
  updateModeControls();

  try {
    const updated = await mutateSettings((settings) => ({
      ...settings,
      mode: nextMode,
    }));
    settingsCache = updated;
    updateUi();
  } finally {
    updatingMode = false;
    updateModeControls();
  }
}

async function requestFocusState() {
  try {
    const response = await runtime.sendMessage<{ ok: boolean; state?: FocusState }>({
      type: "focus-ping::request-focus-state",
    });
    if (response?.ok && response.state) {
      focusStateCache = response.state;
      updateUi();
    }
  } catch (error) {
    console.debug("Failed to request focus state", error);
  }
}

async function triggerTestIntervention(kind: "gentle" | "strict") {
  try {
    const response = (await runtime.sendMessage({
      type: "focus-ping::debug-trigger-intervention",
      payload: { kind },
    })) as { ok?: boolean; reason?: string } | undefined;

    if (!response?.ok) {
      console.warn("Test intervention failed", response?.reason);
      if (reminderLabel) {
        const reason = response?.reason ?? "unknown";
        const message = formatInterventionFailure(kind, reason);
        reminderLabel.textContent = message;
        window.setTimeout(() => updateReminder(), 3000);
      }
      return;
    }

    if (reminderLabel) {
      reminderLabel.textContent = kind === "gentle" ? "Gentle test sent" : "Strict test sent";
      window.setTimeout(() => updateReminder(), 3000);
    }
  } catch (error) {
    console.error("Failed to trigger test intervention", error);
    if (reminderLabel) {
      reminderLabel.textContent = "Test error";
      window.setTimeout(() => updateReminder(), 3000);
    }
  }
}

function formatInterventionFailure(kind: "gentle" | "strict", reason: string) {
  switch (reason) {
    case "no-active-tab":
      return "Open a tab to try the test again.";
    case "unsupported-url":
      return "Switch to a regular website tab before testing.";
    case "invalid-url":
      return "This page has no domain; try another site.";
    default:
      return kind === "gentle" ? "Gentle test failed" : "Strict test failed";
  }
}

toggleButton?.addEventListener("click", () => {
  togglePause().catch(console.error);
});

modeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) {
      void setMode(input.value as Mode);
    }
  });
});

openOptionsButton?.addEventListener("click", () => {
  runtime.openOptionsPage().catch(console.error);
});

testGentleButton?.addEventListener("click", () => {
  triggerTestIntervention("gentle").catch(console.error);
});

testStrictButton?.addEventListener("click", () => {
  triggerTestIntervention("strict").catch(console.error);
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message?.type) {
    return;
  }

  if (message.type === "focus-ping::state-updated") {
    refreshState().catch(console.error);
    return;
  }

  if (message.type === "focus-ping::focus-state") {
    focusStateCache = message.payload as FocusState;
    updateUi();
  }
});

refreshState().catch(console.error);
requestFocusState().catch(console.error);
