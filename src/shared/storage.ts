import { storage as chromeStorage } from "@/shared/chrome";
import { DEFAULT_DISTRACTION_DOMAINS } from "@/shared/blocklist";

export type Mode = "gentle" | "strict";

const SETTINGS_STORAGE_KEY = "settings";
const SESSION_STORAGE_KEY = "session";
const CURRENT_SETTINGS_VERSION = 2;
const CURRENT_SESSION_VERSION = 1;

export interface ScheduleSettings {
  start: string;
  end: string;
  pausedOutsideSchedule: boolean;
  timezone: string;
}

export interface ReminderSettings {
  frequencyMinutes: number;
  showGifs: boolean;
}

export interface Settings {
  version: number;
  mode: Mode;
  paused: boolean;
  schedule: ScheduleSettings;
  reminder: ReminderSettings;
  blocklist: string[];
  blocklistVersion: number;
  disabledBlocklist: string[];
}

export interface SessionState {
  version: number;
  snoozedDomains: Record<string, number>;
  pauseUntil: number | null;
  lastGentleReminderAt: Record<string, number>;
  nextReminderInMinutes: number | null;
  dismissedTabs: number[];
}

const DEFAULT_SETTINGS: Settings = {
  version: CURRENT_SETTINGS_VERSION,
  mode: "gentle",
  paused: false,
  schedule: {
    start: "08:00",
    end: "18:00",
    pausedOutsideSchedule: false,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  reminder: {
    frequencyMinutes: 2,
    showGifs: true,
  },
  blocklist: DEFAULT_DISTRACTION_DOMAINS,
  blocklistVersion: CURRENT_SETTINGS_VERSION,
  disabledBlocklist: [],
};

const DEFAULT_SESSION_STATE: SessionState = {
  version: CURRENT_SESSION_VERSION,
  snoozedDomains: {},
  pauseUntil: null,
  lastGentleReminderAt: {},
  nextReminderInMinutes: null,
  dismissedTabs: [],
};

function normalizeDomainList(domains: string[]): string[] {
  const deduped = new Set<string>();

  domains.forEach((raw) => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) {
      return;
    }
    deduped.add(trimmed);
  });

  return Array.from(deduped).sort();
}

function migrateSettings(payload: Partial<Settings> | undefined): Settings {
  if (!payload) {
    return { ...DEFAULT_SETTINGS };
  }

  const withDefaults: Settings = {
    ...DEFAULT_SETTINGS,
    ...payload,
    schedule: {
      ...DEFAULT_SETTINGS.schedule,
      ...(payload.schedule ?? {}),
    },
    reminder: {
      ...DEFAULT_SETTINGS.reminder,
      ...(payload.reminder ?? {}),
    },
    blocklist: normalizeDomainList(payload.blocklist ?? DEFAULT_SETTINGS.blocklist),
    disabledBlocklist: normalizeDomainList(
      (payload.disabledBlocklist ?? DEFAULT_SETTINGS.disabledBlocklist).filter((domain) =>
        (payload.blocklist ?? DEFAULT_SETTINGS.blocklist).includes(domain),
      ),
    ),
  };

  withDefaults.version = CURRENT_SETTINGS_VERSION;
  withDefaults.blocklistVersion = payload.blocklistVersion ?? DEFAULT_SETTINGS.blocklistVersion;
  withDefaults.disabledBlocklist = withDefaults.disabledBlocklist.filter((domain) =>
    withDefaults.blocklist.includes(domain),
  );

  return withDefaults;
}

function migrateSession(payload: Partial<SessionState> | undefined): SessionState {
  if (!payload) {
    return { ...DEFAULT_SESSION_STATE };
  }

  const withDefaults: SessionState = {
    ...DEFAULT_SESSION_STATE,
    ...payload,
    snoozedDomains: payload.snoozedDomains ?? DEFAULT_SESSION_STATE.snoozedDomains,
    lastGentleReminderAt:
      payload.lastGentleReminderAt ?? DEFAULT_SESSION_STATE.lastGentleReminderAt,
    dismissedTabs: payload.dismissedTabs ?? DEFAULT_SESSION_STATE.dismissedTabs,
  };

  withDefaults.version = CURRENT_SESSION_VERSION;
  return withDefaults;
}

function normalizeSettings(settings: Settings): Settings {
  return {
    ...settings,
    version: CURRENT_SETTINGS_VERSION,
    blocklist: normalizeDomainList(settings.blocklist),
    blocklistVersion: settings.blocklistVersion ?? CURRENT_SETTINGS_VERSION,
    disabledBlocklist: normalizeDomainList(
      settings.disabledBlocklist.filter((domain) => settings.blocklist.includes(domain)),
    ),
  };
}

export async function getSettings(): Promise<Settings> {
  const stored = await chromeStorage.sync.get<Settings | undefined>(
    SETTINGS_STORAGE_KEY,
    undefined,
  );

  // Only write back if settings don't exist or need migration
  if (!stored || stored.version !== CURRENT_SETTINGS_VERSION) {
    const migrated = migrateSettings(stored);
    await chromeStorage.sync.set(SETTINGS_STORAGE_KEY, migrated);
    return migrated;
  }

  return stored;
}

export async function setSettings(next: Settings): Promise<Settings> {
  const normalized = normalizeSettings(next);
  await chromeStorage.sync.set(SETTINGS_STORAGE_KEY, normalized);
  return normalized;
}

export async function mutateSettings(updater: (current: Settings) => Settings): Promise<Settings> {
  const current = await getSettings();
  const next = normalizeSettings(updater(current));
  await chromeStorage.sync.set(SETTINGS_STORAGE_KEY, next);
  return next;
}

export async function getSessionState(): Promise<SessionState> {
  const stored = await chromeStorage.local.get<SessionState | undefined>(
    SESSION_STORAGE_KEY,
    undefined,
  );
  const migrated = migrateSession(stored);
  await chromeStorage.local.set(SESSION_STORAGE_KEY, migrated);
  return migrated;
}

export async function setSessionState(next: SessionState): Promise<SessionState> {
  const normalized = migrateSession(next);
  await chromeStorage.local.set(SESSION_STORAGE_KEY, normalized);
  return normalized;
}

export async function mutateSessionState(
  updater: (current: SessionState) => SessionState,
): Promise<SessionState> {
  const current = await getSessionState();
  const next = migrateSession(updater(current));
  await chromeStorage.local.set(SESSION_STORAGE_KEY, next);
  return next;
}

export function onSettingsChanged(listener: (settings: Settings) => void) {
  chromeStorage.sync.watch<Settings>(SETTINGS_STORAGE_KEY, (value) =>
    listener(migrateSettings(value)),
  );
}

export const defaults = {
  settings: DEFAULT_SETTINGS,
  session: DEFAULT_SESSION_STATE,
};

export function resetToDefaults() {
  return Promise.all([
    chromeStorage.sync.set(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS),
    chromeStorage.local.set(SESSION_STORAGE_KEY, DEFAULT_SESSION_STATE),
  ]);
}

export const STORAGE_KEYS = {
  settings: SETTINGS_STORAGE_KEY,
  session: SESSION_STORAGE_KEY,
};
