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

const GENTLE_REMINDER_PREFIX = "focusping::gentle-reminder::";
const SNOOZE_ALARM_PREFIX = "focusping::snooze-expire::";
const MS_PER_MINUTE = 60_000;

type ScriptingApi = {
  executeScript?: (opts: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
};

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

interface DebugTriggerPayload {
  kind: InterventionKind;
}

let initialized = false;
let initializing: Promise<InterventionState | null> | null = null;
let listenersRegistered = false;
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
  // Keep an informational message but avoid noisy stack traces in normal flows.
  console.info(
    "[Mode Controller] Message send failed:",
    error instanceof Error ? error.message : error,
  );
}

// Try to inject the content script into a tab and return a promise that
// resolves once injection is attempted. This is a best-effort recovery when
// `tabs.sendMessage` fails with "Receiving end does not exist" because the
// content script isn't present in the tab (for example after extension install).
async function injectContentScriptToTab(tabId: number) {
  try {
    const scripting = (chrome as unknown as { scripting?: ScriptingApi }).scripting;
    if (!scripting || typeof scripting.executeScript !== "function") {
      console.warn(
        "[Mode Controller] chrome.scripting.executeScript is not available in this environment. Ensure the manifest includes 'scripting' permission.",
      );
      return false;
    }

    // Fetch the tab URL so we can check whether we have host permission for it.
    const tab = await new Promise<chrome.tabs.Tab | undefined>((resolve) => {
      try {
        chrome.tabs.get(tabId, (t) => resolve(t as chrome.tabs.Tab | undefined));
      } catch (e) {
        resolve(undefined);
      }
    });

    const tabUrl = tab?.url;
    if (!tabUrl) {
      console.warn("[Mode Controller] Cannot determine tab URL for injection; skipping.");
      return false;
    }

    let origin: string;
    try {
      origin = new URL(tabUrl).origin;
    } catch (e) {
      console.warn("[Mode Controller] Could not parse tab URL; skipping injection", tabUrl);
      return false;
    }

    // Check whether we have permission for this origin.
    const hasHostPermission = await new Promise<boolean>((resolve) => {
      if (!chrome.permissions || typeof chrome.permissions.contains !== "function") {
        resolve(false);
        return;
      }
      try {
        chrome.permissions.contains({ origins: [origin + "/*"] }, (granted: boolean) =>
          resolve(Boolean(granted)),
        );
      } catch (e) {
        resolve(false);
      }
    });

    if (!hasHostPermission) {
      console.debug(
        "[Mode Controller] No host permission for",
        origin,
        "; not attempting injection. To allow injection, add this origin to manifest host_permissions.",
      );
      return false;
    }

    // injecting content script into tab (best-effort)
    await scripting.executeScript!({ target: { tabId }, files: ["content.js"] });
    // Give the content script a short moment to initialize.
    await new Promise((r) => setTimeout(r, 150));
    // injection attempted
    return true;
  } catch (err) {
    console.warn(
      "[Mode Controller] Content script injection failed",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
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
    console.debug("[Mode Controller] Sending gentle intervention to tab", tabId);
    await tabs.sendMessage(tabId, {
      type: "focusping::gentle-intervention",
      payload,
    });
    console.debug("[Mode Controller] tabs.sendMessage succeeded for gentle", tabId);
  } catch (error) {
    // If the receiving end does not exist, try injecting the content script once
    // and retry the message.
    const needInjection =
      error instanceof Error && /Receiving end does not exist/.test(error.message);
    if (needInjection) {
      console.debug(
        "[Mode Controller] tabs.sendMessage failed; attempting injection and retry",
        tabId,
      );
      await injectContentScriptToTab(tabId);
      try {
        await tabs.sendMessage(tabId, {
          type: "focusping::gentle-intervention",
          payload,
        });
        console.debug("[Mode Controller] tabs.sendMessage retry succeeded for gentle", tabId);
      } catch (err2) {
        handleMissingListener(err2);
      }
    } else {
      handleMissingListener(error);
    }
  }

  try {
    // Broadcast to any runtime listeners (best-effort)
    console.debug("[Mode Controller] Broadcasting gentle intervention to runtime listeners", tabId);
    await runtime.sendMessage({
      type: "focusping::gentle-intervention",
      payload: { ...payload, tabId },
    });
    console.debug("[Mode Controller] runtime.sendMessage succeeded for gentle", tabId);
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
    console.debug("[Mode Controller] Sending strict intervention to tab", tabId);
    await tabs.sendMessage(tabId, {
      type: "focusping::strict-intervention",
      payload,
    });
    console.debug("[Mode Controller] tabs.sendMessage succeeded for strict", tabId);
  } catch (error) {
    const needInjection =
      error instanceof Error && /Receiving end does not exist/.test(error.message);
    if (needInjection) {
      console.debug(
        "[Mode Controller] tabs.sendMessage failed; attempting injection and retry",
        tabId,
      );
      await injectContentScriptToTab(tabId);
      try {
        await tabs.sendMessage(tabId, {
          type: "focusping::strict-intervention",
          payload,
        });
        console.debug("[Mode Controller] tabs.sendMessage retry succeeded for strict", tabId);
      } catch (err2) {
        handleMissingListener(err2);
      }
    } else {
      handleMissingListener(error);
    }
  }

  try {
    console.debug("[Mode Controller] Broadcasting strict intervention to runtime listeners", tabId);
    await runtime.sendMessage({
      type: "focusping::strict-intervention",
      payload: { ...payload, tabId },
    });
    console.debug("[Mode Controller] runtime.sendMessage succeeded for strict", tabId);
  } catch (error) {
    handleMissingListener(error);
  }
}

async function sendClearIntervention(tabId: number, reason: string) {
  try {
    console.debug("[Mode Controller] Sending clear intervention to tab", tabId);
    await tabs.sendMessage(tabId, {
      type: "focusping::clear-intervention",
      payload: { reason },
    });
    console.debug("[Mode Controller] tabs.sendMessage succeeded for clear", tabId);
  } catch (error) {
    const needInjection =
      error instanceof Error && /Receiving end does not exist/.test(error.message);
    if (needInjection) {
      console.debug(
        "[Mode Controller] tabs.sendMessage failed; attempting injection and retry",
        tabId,
      );
      await injectContentScriptToTab(tabId);
      try {
        await tabs.sendMessage(tabId, {
          type: "focusping::clear-intervention",
          payload: { reason },
        });
        console.debug("[Mode Controller] tabs.sendMessage retry succeeded for clear", tabId);
      } catch (err2) {
        handleMissingListener(err2);
      }
    } else {
      handleMissingListener(error);
    }
  }

  try {
    console.debug("[Mode Controller] Broadcasting clear intervention to runtime listeners", tabId);
    await runtime.sendMessage({
      type: "focusping::clear-intervention",
      payload: { reason, tabId },
    });
    console.debug("[Mode Controller] runtime.sendMessage succeeded for clear", tabId);
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
  if (listenersRegistered) {
    return;
  }

  listenersRegistered = true;
  chrome.tabs.onActivated.addListener((activeInfo) => {
    if (
      currentIntervention &&
      currentIntervention.kind === "strict" &&
      currentIntervention.tabId !== activeInfo.tabId
    ) {
      void clearCurrentIntervention("tab-switched");
    }
    requestEvaluation("tab-activated");
  });

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

    // received message

    if (message.type === "focusping::command-snooze") {
      void handleSnoozeCommand(message.payload).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "focusping::command-dismiss-gentle") {
      void handleDismissGentleCommand(message.payload).then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "focusping::command-open-focus-tab") {
      void tabs
        .create({})
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          console.error("Failed to open focus tab", error);
          sendResponse({ ok: false });
        });
      return true;
    }

    if (message.type === "focusping::request-focus-state") {
      sendResponse({ ok: true, state: getCurrentFocusState() });
      return true;
    }

    if (message.type === "focusping::debug-trigger-intervention") {
      void handleDebugTrigger(message.payload as DebugTriggerPayload | undefined)
        .then((result) => sendResponse(result))
        .catch((error) => {
          console.error("Failed to trigger debug intervention", error);
          sendResponse({ ok: false, reason: "error" });
        });
      return true;
    }

    return undefined;
  });

  // When a content script comes online in a tab (for example after the extension is
  // reloaded/installed), it will send a `focusping::content-ready` message. If we
  // currently have an active intervention for that tab/domain, re-send it so the
  // UI appears without the user needing to reload the page.
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== "focusping::content-ready") {
      return;
    }

    // Sender may be undefined when message originates from the background; only
    // act when we have a tab id on the sender.
    // content-ready received
    const tabId = sender && (sender.tab as chrome.tabs.Tab | undefined)?.id;
    if (typeof tabId !== "number") {
      console.warn("[Mode Controller] content-ready had no tab id, ignoring", sender);
      return;
    }

    // If we have a current intervention for this tab, re-send it.
    if (!currentIntervention) {
      // no current intervention to re-send
      return;
    }

    const iv = currentIntervention;
    if (iv.tabId !== tabId) {
      return;
    }

    (async () => {
      try {
        if (iv.kind === "gentle") {
          await sendGentleIntervention(
            iv.tabId,
            iv.domain,
            iv.pattern,
            iv.url,
            Math.max(1, settings?.reminder.frequencyMinutes ?? 5),
          );
        } else {
          await sendStrictIntervention(iv.tabId, iv.domain, iv.pattern, iv.url);
        }
      } catch (error) {
        console.error("Failed to re-send intervention on content-ready", error);
      }
    })();
  });
}

async function handleDebugTrigger(
  payload: DebugTriggerPayload | undefined,
): Promise<{ ok: boolean; reason?: string }> {
  const requestedKind = payload?.kind ?? "gentle";

  // handling debug trigger

  await ensureSettingsLoaded();
  const activeSettings = settings;

  const tab = await tabs.getActive();
  if (!tab || typeof tab.id !== "number") {
    return { ok: false, reason: "no-active-tab" };
  }

  // For testing, use dummy values to work on any tab
  const domain = "example.com";
  const pattern = null;
  const url = "https://example.com";

  // sending debug intervention to tab

  if (requestedKind === "strict") {
    await sendStrictIntervention(tab.id, domain, pattern, url);
    return { ok: true };
  } else {
    const frequencyMinutes = Math.max(1, activeSettings?.reminder.frequencyMinutes ?? 5);
    await sendGentleIntervention(tab.id, domain, pattern, url, frequencyMinutes);
    return { ok: true };
  }
}

export async function initializeModeController() {
  registerListeners();

  if (initialized) {
    return currentIntervention;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
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

    initialized = true;
    requestEvaluation("init");
    return currentIntervention;
  })()
    .catch((error) => {
      // Surface initialization errors to the caller for logging.
      throw error;
    })
    .finally(() => {
      initializing = null;
    });

  return initializing;
}

export function getCurrentIntervention() {
  return currentIntervention;
}
