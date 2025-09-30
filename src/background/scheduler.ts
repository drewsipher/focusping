import { DateTime } from "luxon";
import { alarms } from "@/shared/chrome";
import {
  computeFocusWindow,
  determineFocusStatus,
  type FocusWindowComputation,
} from "@/shared/focus-window";
import type { FocusState } from "@/shared/focus-state";
import { getSessionState, getSettings, onSettingsChanged } from "@/shared/storage";

type FocusStateListener = (state: FocusState) => void;

const START_ALARM_NAME = "focus-ping::focus-window-start";
const END_ALARM_NAME = "focus-ping::focus-window-end";

let initialized = false;
let currentState: FocusState | null = null;
const listeners = new Set<FocusStateListener>();

function dateTimeToIso(dateTime: DateTime): string {
  return dateTime.toUTC().toISO();
}

function dateTimeToMillis(dateTime: DateTime): number {
  return dateTime.toUTC().toMillis();
}

async function scheduleAlarms(window: FocusWindowComputation) {
  await Promise.all([alarms.clear(START_ALARM_NAME), alarms.clear(END_ALARM_NAME)]);

  const nowMillis = DateTime.utc().toMillis();
  const nextStartWhen = window.nextStart.toUTC().toMillis();
  const nextEndWhen = window.nextEnd.toUTC().toMillis();

  if (nextStartWhen > nowMillis + 1000) {
    await alarms.create(START_ALARM_NAME, { when: dateTimeToMillis(window.nextStart) });
  }

  if (nextEndWhen > nowMillis + 1000) {
    await alarms.create(END_ALARM_NAME, { when: dateTimeToMillis(window.nextEnd) });
  }
}

function emit(state: FocusState) {
  const previousSerialized = currentState ? JSON.stringify(currentState) : null;
  const nextSerialized = JSON.stringify(state);
  if (previousSerialized === nextSerialized) {
    return;
  }

  currentState = state;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("Scheduler listener failed", error);
    }
  });
}

async function evaluate(reason: string) {
  const now = DateTime.utc();
  const [settings, session] = await Promise.all([getSettings(), getSessionState()]);
  const window = computeFocusWindow(settings, now);
  const { status, isMonitoring } = determineFocusStatus(settings, session, window, now);

  await scheduleAlarms(window);

  let nextTransition: DateTime | null = null;
  if (window.isWithinWindow) {
    nextTransition = window.end;
  } else {
    nextTransition = window.start;
  }

  const state: FocusState = {
    status,
    isFocusWindow: window.isWithinWindow,
    isMonitoring,
    windowStartIso: dateTimeToIso(window.start),
    windowEndIso: dateTimeToIso(window.end),
    nextStartIso: dateTimeToIso(window.nextStart),
    nextEndIso: dateTimeToIso(window.nextEnd),
    nextTransitionIso: nextTransition ? dateTimeToIso(nextTransition) : null,
    timezone: window.start.zoneName ?? settings.schedule.timezone,
    evaluatedAtIso: now.toISO(),
  };

  emit(state);
  if (reason) {
    console.debug("Focus scheduler evaluated", { reason, state });
  }
}

function handleAlarm(alarm: chrome.alarms.Alarm) {
  if (alarm.name === START_ALARM_NAME || alarm.name === END_ALARM_NAME) {
    evaluate(`alarm:${alarm.name}`).catch(console.error);
  }
}

export async function initializeScheduler() {
  if (initialized) {
    return currentState;
  }

  chrome.alarms.onAlarm.addListener(handleAlarm);
  onSettingsChanged(() => {
    evaluate("settings-changed").catch(console.error);
  });

  initialized = true;
  await evaluate("init");
  return currentState;
}

export function subscribeToFocusState(listener: FocusStateListener) {
  listeners.add(listener);
  if (currentState) {
    listener(currentState);
  }
  return () => listeners.delete(listener);
}

export function getCurrentFocusState() {
  return currentState;
}

export type { FocusState } from "@/shared/focus-state";

export async function refreshFocusState(reason = "manual-refresh") {
  await evaluate(reason);
}
