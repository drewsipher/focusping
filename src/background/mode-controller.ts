import { alarms, runtime, tabs } from "@/shared/chrome";
import {
  getSettings,
  getSessionState,
  mutateSessionState,
  onSettingsChanged,
  type SessionState,
  type Settings,
} from "@/shared/storage";
import { getCurrentFocusState, subscribeToFocusState, type FocusState } from "./scheduler";
import { initializeSiteDetector, matchUrl, subscribeToBlocklist } from "./site-detector";

const GENTLE_REMINDER_PREFIX = "focus-ping::gentle-reminder::";
const SNOOZE_ALARM_PREFIX = "focus-ping::snooze-expire::";
const MS_PER_MINUTE = 60_000;

type InterventionKind = "gentle" | "strict";

interface InterventionState {
  kind: InterventionKind;
  domain: string;
  tabId: number;
  pattern: string | null;
  url: string;
  triggeredAt: number;
  reminderDueAt?: number;
}

interface SnoozeCommandPayload {
  domain?: string;
  minutes?: number;
}

interface DismissCommandPayload {
  domain?: string;
}

let initialized = false;
let focusState: FocusState | null = null;
let settings: Settings | null = null;
let currentIntervention: InterventionState | null = null;
let evaluateInProgress = false;
let evaluatePending = false;

function gentleAlarmName(domain: string) {
  return `${GENTLE_REMINDER_PREFIX}${domain}`;
}

function snoozeAlarmName(domain: string) {
  return `${SNOOZE_ALARM_PREFIX}${domain}`;
}

function isUrlMatchable(url: string | undefined) {
  if (!url) {
    return false;
  }

  if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    return false;
  }

  if (url.startsWith("edge://") || url.startsWith("about:")) {
    return false;
  }

  return /^https?:/i.test(url);
}

function secondsToMinutesRounded(ms: number) {
  return Math.max(0, Math.round(ms / MS_PER_MINUTE));
}

async function scheduleGentleReminder(domain: string, dueAt: number) {
  await alarms.clear(gentleAlarmName(domain));
  await alarms.create(gentleAlarmName(domain), { when: dueAt });
}

async function clearGentleReminder(domain: string | null) {
  if (!domain) {
    return;
  }
  await alarms.clear(gentleAlarmName(domain));
}

async function scheduleSnoozeExpiry(domain: string, expiresAt: number) {
  await alarms.clear(snoozeAlarmName(domain));
  await alarms.create(snoozeAlarmName(domain), { when: expiresAt });
}

async function clearSnoozeExpiry(domain: string) {
  await alarms.clear(snoozeAlarmName(domain));
}

function handleMissingListener(error: unknown) {
  if (error instanceof Error && /Receiving end does not exist/.test(error.message)) {
    return;
  }
  console.debug("No active listeners for mode controller message", error);
}

async function sendGentleIntervention(
  tabId: number,
  domain: string,
  pattern: string | null,
  url: string,
  frequencyMinutes: number,
) {
  const payload = {
    domain,
    pattern,
    url,
    triggeredAtIso: new Date().toISOString(),
    repeatAfterMinutes: frequencyMinutes,
  };

  try {
    await tabs.sendMessage(tabId, {
      type: "focus-ping::gentle-intervention",
      payload,
    });
  } catch (error) {
    handleMissingListener(error);
  }

  try {
    await runtime.sendMessage({
      type: "focus-ping::gentle-intervention",
      payload: { ...payload, tabId },
    });
  } catch (error) {
    handleMissingListener(error);
  }
}

async function sendStrictIntervention(
  tabId: number,
  domain: string,
  pattern: string | null,
  url: string,
) {
  const payload = {
    domain,
    pattern,
    url,
    triggeredAtIso: new Date().toISOString(),
  };

  try {
    await tabs.sendMessage(tabId, {
      type: "focus-ping::strict-intervention",
      payload,
    });
  } catch (error) {
    handleMissingListener(error);
  }

  try {
    await runtime.sendMessage({
      type: "focus-ping::strict-intervention",
      payload: { ...payload, tabId },
    });
  } catch (error) {
    handleMissingListener(error);
  }
}

async function sendClearIntervention(tabId: number, reason: string) {
  try {
    await tabs.sendMessage(tabId, {
      type: "focus-ping::clear-intervention",
      payload: { reason },
    });
  } catch (error) {
    handleMissingListener(error);
  }

  try {
    await runtime.sendMessage({
      type: "focus-ping::clear-intervention",
      payload: { reason, tabId },
    });
  } catch (error) {
    handleMissingListener(error);
  }
}

async function updateSessionGentleState(
  domain: string,
  frequencyMinutes: number,
  timestamp: number,
) {
  await mutateSessionState((session) => {
    const next = { ...session };
    next.lastGentleReminderAt = {
      ...session.lastGentleReminderAt,
      [domain]: timestamp,
    };
    next.nextReminderInMinutes = frequencyMinutes;
    return next;
  });
}

async function clearSessionReminderState() {
  await mutateSessionState((session) => {
    if (session.nextReminderInMinutes === null) {
      return session;
    }
    return {
      ...session,
      nextReminderInMinutes: null,
    };
  });
}

async function ensureSettingsLoaded() {
  if (!settings) {
    settings = await getSettings();
  }
}

async function ensureFocusState() {
  if (!focusState) {
    focusState = getCurrentFocusState();
  }
}

async function clearCurrentIntervention(
  reason: string,
  options: { skipTabMessage?: boolean } = {},
) {
  if (!currentIntervention) {
    return;
  }

  const { domain, tabId, kind } = currentIntervention;
  currentIntervention = null;

  await clearGentleReminder(kind === "gentle" ? domain : null);

  if (!options.skipTabMessage) {
    await sendClearIntervention(tabId, reason);
  }

  await clearSessionReminderState();
}

function pruneExpiredSnoozes(session: SessionState, now: number): SessionState {
  const nextSnoozed = { ...session.snoozedDomains };
  let mutated = false;

  Object.entries(nextSnoozed).forEach(([domain, expiresAt]) => {
    if (!expiresAt || expiresAt <= now) {
      delete nextSnoozed[domain];
      mutated = true;
      void alarms.clear(snoozeAlarmName(domain));
    }
  });

  if (!mutated) {
    return session;
  }

  return {
    ...session,
    snoozedDomains: nextSnoozed,
  };
}

async function isDomainSnoozed(domain: string, session: SessionState, now: number) {
  const expiresAt = session.snoozedDomains[domain];
  if (!expiresAt) {
    return false;
  }

  if (expiresAt <= now) {
    await mutateSessionState((current) => {
      const next = { ...current };
      const nextSnoozed = { ...current.snoozedDomains };
      delete nextSnoozed[domain];
      next.snoozedDomains = nextSnoozed;
      return next;
    });
    await clearSnoozeExpiry(domain);
    return false;
  }

  await scheduleSnoozeExpiry(domain, expiresAt);
  return true;
}

async function handleGentleIntervention(
  tab: chrome.tabs.Tab,
  domain: string,
  pattern: string | null,
  url: string,
  session: SessionState,
) {
  if (!settings) {
    return;
  }

  const frequencyMinutes = Math.max(1, settings.reminder.frequencyMinutes || 5);
  const now = Date.now();
  const last = session.lastGentleReminderAt[domain] ?? 0;
  const frequencyMs = frequencyMinutes * MS_PER_MINUTE;
  const elapsed = now - last;

  if (
    currentIntervention?.kind === "gentle" &&
    currentIntervention.domain === domain &&
    currentIntervention.tabId === tab.id &&
    elapsed < frequencyMs
  ) {
    const remainingMs = Math.max(0, frequencyMs - elapsed);
    if (remainingMs > 0) {
      await scheduleGentleReminder(domain, now + remainingMs);
      await mutateSessionState((state) => ({
        ...state,
        nextReminderInMinutes: secondsToMinutesRounded(remainingMs),
      }));
    }
    return;
  }

  if (typeof tab.id !== "number") {
    return;
  }

  await sendGentleIntervention(tab.id, domain, pattern, url, frequencyMinutes);
  await scheduleGentleReminder(domain, now + frequencyMs);
  await updateSessionGentleState(domain, frequencyMinutes, now);

  currentIntervention = {
    kind: "gentle",
    domain,
    pattern,
    tabId: tab.id,
    url,
    triggeredAt: now,
    reminderDueAt: now + frequencyMs,
  };
}

async function handleStrictIntervention(
  tab: chrome.tabs.Tab,
  domain: string,
  pattern: string | null,
  url: string,
) {
  if (typeof tab.id !== "number") {
    return;
  }

  if (
    currentIntervention?.kind === "strict" &&
    currentIntervention.domain === domain &&
    currentIntervention.tabId === tab.id
  ) {
    return;
  }

  await sendStrictIntervention(tab.id, domain, pattern, url);

  currentIntervention = {
    kind: "strict",
    domain,
    pattern,
    tabId: tab.id,
    url,
    triggeredAt: Date.now(),
  };

  await clearSessionReminderState();
}

async function evaluate(reason: string) {
  await ensureSettingsLoaded();
  await ensureFocusState();
  const state = focusState;
  const activeSettings = settings;

  if (!state || !activeSettings) {
    return;
  }

  console.debug("Mode controller evaluating", {
    reason,
    focusStatus: state.status,
  });

  if (!state.isMonitoring || state.status !== "active") {
    await clearCurrentIntervention("focus-inactive");
    return;
  }

  const tab = await tabs.getActive();
  if (!tab || typeof tab.id !== "number") {
    await clearCurrentIntervention("no-active-tab");
    return;
  }

  const url = tab.url ?? tab.pendingUrl;
  if (!isUrlMatchable(url)) {
    await clearCurrentIntervention("unsupported-url");
    return;
  }

  const match = matchUrl(url!);
  if (!match.matched || !match.host) {
    await clearCurrentIntervention("no-match");
    return;
  }

  const domain = match.host;
  const now = Date.now();
  let session = await getSessionState();
  session = pruneExpiredSnoozes(session, now);

  if (await isDomainSnoozed(domain, session, now)) {
    await clearCurrentIntervention("domain-snoozed");
    return;
  }

  if (activeSettings.mode === "gentle") {
    await handleGentleIntervention(tab, domain, match.pattern, url!, session);
    return;
  }

  await handleStrictIntervention(tab, domain, match.pattern, url!);
}

function requestEvaluation(reason: string) {
  if (evaluateInProgress) {
    evaluatePending = true;
    return;
  }

  evaluateInProgress = true;
  void evaluate(reason)
    .catch((error) => {
      console.error("Failed to evaluate mode controller", { reason, error });
    })
    .finally(() => {
      evaluateInProgress = false;
      if (evaluatePending) {
        evaluatePending = false;
        requestEvaluation("pending");
      }
    });
}

async function handleSnoozeCommand(payload: SnoozeCommandPayload | undefined) {
  await ensureSettingsLoaded();
  const activeSettings = settings;
  if (!activeSettings) {
    return;
  }

  const targetDomain = payload?.domain ?? currentIntervention?.domain;
  if (!targetDomain) {
    return;
  }

  const minutes = Math.max(1, payload?.minutes ?? activeSettings.reminder.snoozeMinutes ?? 10);
  const expiresAt = Date.now() + minutes * MS_PER_MINUTE;

  await mutateSessionState((session) => ({
    ...session,
    snoozedDomains: {
      ...session.snoozedDomains,
      [targetDomain]: expiresAt,
    },
    nextReminderInMinutes: null,
  }));

  await scheduleSnoozeExpiry(targetDomain, expiresAt);
  await clearCurrentIntervention("snoozed");
  requestEvaluation("snoozed");
}

async function handleDismissGentleCommand(payload: DismissCommandPayload | undefined) {
  const targetDomain = payload?.domain ?? currentIntervention?.domain;
  if (!targetDomain) {
    return;
  }

  const now = Date.now();
  await mutateSessionState((session) => ({
    ...session,
    lastGentleReminderAt: {
      ...session.lastGentleReminderAt,
      [targetDomain]: now,
    },
    nextReminderInMinutes: null,
  }));

  if (currentIntervention?.kind === "gentle" && currentIntervention.domain === targetDomain) {
    await clearGentleReminder(targetDomain);
    await clearCurrentIntervention("gentle-dismissed");
  }
}

function registerListeners() {
  chrome.tabs.onActivated.addListener(() => requestEvaluation("tab-activated"));

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
      if (tab.active) {
        requestEvaluation("tab-updated");
      }
    }
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (currentIntervention?.tabId === tabId) {
      void clearCurrentIntervention("tab-removed", { skipTabMessage: true });
    }
  });

  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
      requestEvaluation("window-focus");
    }
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name.startsWith(GENTLE_REMINDER_PREFIX)) {
      currentIntervention = null;
      requestEvaluation("gentle-reminder");
      return;
    }
    if (alarm.name.startsWith(SNOOZE_ALARM_PREFIX)) {
      requestEvaluation("snooze-expired");
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.type) {
      return;
    }

    if (message.type === "focus-ping::command-snooze") {
      void handleSnoozeCommand(message.payload).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "focus-ping::command-dismiss-gentle") {
      void handleDismissGentleCommand(message.payload).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "focus-ping::command-open-focus-tab") {
      void tabs
        .create({})
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.error("Failed to open focus tab", error);
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "focus-ping::request-focus-state") {
      sendResponse({ ok: true, state: getCurrentFocusState() });
      return true;
    }

    return undefined;
  });
}

export async function initializeModeController() {
  if (initialized) {
    return currentIntervention;
  }

  await initializeSiteDetector();

  focusState = getCurrentFocusState();
  settings = await getSettings();
  subscribeToFocusState((state) => {
    focusState = state;
    requestEvaluation("focus-state-update");
  });

  subscribeToBlocklist(() => {
    requestEvaluation("blocklist-update");
  });

  onSettingsChanged((next) => {
    settings = next;
    requestEvaluation("settings-changed");
  });

  registerListeners();
  initialized = true;

  requestEvaluation("init");
  return currentIntervention;
}

export function getCurrentIntervention() {
  return currentIntervention;
}
