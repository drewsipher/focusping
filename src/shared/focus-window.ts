import { DateTime } from "luxon";
import type { SessionState, Settings } from "@/shared/storage";

export type FocusStatus = "active" | "manually-paused" | "outside-schedule" | "snoozed";

export interface FocusWindowComputation {
  start: DateTime;
  end: DateTime;
  isWithinWindow: boolean;
  nextStart: DateTime;
  nextEnd: DateTime;
}

function parseTime(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number.parseInt(part, 10));
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid time value: ${value}`);
  }
  return { hour, minute };
}

export function computeFocusWindow(settings: Settings, now: DateTime): FocusWindowComputation {
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

  return {
    start: windowStart,
    end: windowEnd,
    isWithinWindow,
    nextStart,
    nextEnd,
  };
}

export function determineFocusStatus(
  settings: Settings,
  session: SessionState,
  window: FocusWindowComputation,
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
