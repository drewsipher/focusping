import { DateTime } from "luxon";
import { alarms } from "@/shared/chrome";
import {
  getSessionState,
  getSettings,
  onSettingsChanged,
  type SessionState,
  type Settings,
} from "@/shared/storage";

export type FocusStatus = "active" | "manually-paused" | "outside-schedule" | "snoozed";

export interface FocusState {
  status: FocusStatus;
  isFocusWindow: boolean;
  isMonitoring: boolean;
  windowStartIso: string;
  windowEndIso: string;
  nextStartIso: string;
  nextEndIso: string;
  nextTransitionIso: string | null;
  timezone: string;
  evaluatedAtIso: string;
}

type FocusStateListener = (state: FocusState) => void;

const START_ALARM_NAME = "focus-ping::focus-window-start";
const END_ALARM_NAME = "focus-ping::focus-window-end";

let initialized = false;
let currentState: FocusState | null = null;
const listeners = new Set<FocusStateListener>();

function parseTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return { hour, minute };
}

interface WindowComputation {
  start: DateTime;
  end: DateTime;
  isWithinWindow: boolean;
  nextStart: DateTime;
  nextEnd: DateTime;
}

function computeWindow(settings: Settings, now: DateTime): WindowComputation {
  const zone = settings.schedule.timezone || DateTime.local().zoneName;
  const zonedNow = now.setZone(zone).startOf("minute");

  const { hour: startHour, minute: startMinute } = parseTime(settings.schedule.start);
  const { hour: endHour, minute: endMinute } = parseTime(settings.schedule.end);

  let windowStart = zonedNow.set({
    hour: startHour,
    minute: startMinute,
    second: 0,
    millisecond: 0,
  });
  let windowEnd = zonedNow.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });

  if (windowEnd <= windowStart) {
    windowEnd = windowEnd.plus({ days: 1 });
  }

  while (zonedNow >= windowEnd) {
    windowStart = windowStart.plus({ days: 1 });
    windowEnd = windowEnd.plus({ days: 1 });
  }

  const isWithinWindow = zonedNow >= windowStart && zonedNow < windowEnd;
  const nextStart = isWithinWindow ? windowStart.plus({ days: 1 }) : windowStart;
  const nextEnd = windowEnd;

  return { start: windowStart, end: windowEnd, isWithinWindow, nextStart, nextEnd };
}

function dateTimeToIso(dateTime: DateTime): string {
  return dateTime.toUTC().toISO();
}

function dateTimeToMillis(dateTime: DateTime): number {
  return dateTime.toUTC().toMillis();
}

function determineStatus(
  settings: Settings,
  session: SessionState,
  window: WindowComputation,
  now: DateTime,
): { status: FocusStatus; isMonitoring: boolean } {
  const nowMillis = now.toMillis();
  if (session.pauseUntil && session.pauseUntil > nowMillis) {
    return { status: "snoozed", isMonitoring: false };
  }

  if (settings.paused) {
    return { status: "manually-paused", isMonitoring: false };
  }

  if (!window.isWithinWindow && settings.schedule.pausedOutsideSchedule) {
    return { status: "outside-schedule", isMonitoring: false };
  }

  return {
    status: "active",
    isMonitoring: window.isWithinWindow || !settings.schedule.pausedOutsideSchedule,
  };
}

async function scheduleAlarms(window: WindowComputation) {
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
  const window = computeWindow(settings, now);
  const { status, isMonitoring } = determineStatus(settings, session, window, now);

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
    timezone: window.start.zoneName,
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

export async function refreshFocusState(reason = "manual-refresh") {
  await evaluate(reason);
}
