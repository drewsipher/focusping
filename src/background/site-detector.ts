import { DEFAULT_BLOCKLIST_VERSION, DEFAULT_DISTRACTION_DOMAINS } from "@/shared/blocklist";
import { getSettings, mutateSettings, onSettingsChanged, type Settings } from "@/shared/storage";

export interface BlocklistState {
  patterns: string[];
  version: number;
  updatedAtIso: string;
}

export interface SiteDetectionMatch {
  matched: boolean;
  pattern: string | null;
  host: string | null;
  pathPattern: string | null;
}

type BlocklistListener = (state: BlocklistState) => void;

interface CompiledPattern {
  pattern: string;
  hostPattern: string;
  pathPattern: string | null;
  regex: RegExp | null;
  suffix: string;
}

let currentState: BlocklistState | null = null;
let compiledPatterns: CompiledPattern[] = [];
let initialized = false;
let initializing: Promise<BlocklistState> | null = null;
let lastSerializedPatterns = "";
const listeners = new Set<BlocklistListener>();
const regexCache = new Map<string, RegExp>();
let upgradeInFlight = false;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePattern(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  const withoutProtocol = trimmed.replace(/^[a-z]+:\/\//i, "");
  const withoutParams = withoutProtocol.split(/[?#]/, 1)[0];
  const withoutTrailingSlash = withoutParams.replace(/\/+$/, "");
  return withoutTrailingSlash;
}

function buildRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern);
  if (cached) {
    return cached;
  }

  const segments = pattern.split(".").map((segment) => {
    if (segment === "*") {
      return "[^.]+";
    }

    if (segment.includes("*")) {
      const escapedSegments = segment
        .split("*")
        .map((piece) => escapeRegex(piece))
        .join("[^.]*");
      return escapedSegments || "[^.]*";
    }

    return escapeRegex(segment);
  });

  const regex = new RegExp(`^${segments.join("\\.")}$`, "i");
  regexCache.set(pattern, regex);
  return regex;
}

function matchesHost(host: string, compiled: CompiledPattern): boolean {
  const hostPattern = compiled.hostPattern;
  const normalizedHost = host.toLowerCase();

  if (hostPattern === "*") {
    return true;
  }

  if (!hostPattern.includes("*")) {
    return normalizedHost === hostPattern || normalizedHost.endsWith(`.${hostPattern}`);
  }

  if (hostPattern.startsWith("*.")) {
    const suffix = compiled.suffix;
    if (!suffix) {
      return true;
    }
    if (normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`)) {
      return true;
    }
  }

  const regex = compiled.regex ?? buildRegex(hostPattern);
  compiled.regex = regex;
  return regex.test(normalizedHost);
}

function matchesPath(path: string, compiled: CompiledPattern): boolean {
  if (!compiled.pathPattern) {
    return true;
  }

  return path.toLowerCase().startsWith(compiled.pathPattern);
}

function compilePattern(pattern: string): CompiledPattern | null {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    return null;
  }

  const [hostPart, ...pathParts] = normalized.split("/");
  const hostPattern = hostPart;
  const pathPattern = pathParts.length ? `/${pathParts.join("/")}` : null;

  return {
    pattern: normalized,
    hostPattern,
    pathPattern,
    regex: null,
    suffix: hostPattern.startsWith("*.") ? hostPattern.slice(2) : hostPattern,
  };
}

function resolveBlocklist(settings: Settings): { patterns: string[]; upgraded: boolean } {
  const baseList = settings.blocklist ?? [];
  const shouldUpgrade = (settings.blocklistVersion ?? 0) < DEFAULT_BLOCKLIST_VERSION;
  const source = shouldUpgrade
    ? [...DEFAULT_DISTRACTION_DOMAINS, ...baseList]
    : baseList.length > 0
      ? baseList
      : DEFAULT_DISTRACTION_DOMAINS;

  const normalized = new Set<string>();
  const disabled = new Set(settings.disabledBlocklist ?? []);

  source.forEach((pattern) => {
    const compiled = normalizePattern(pattern);
    if (compiled && !disabled.has(compiled)) {
      normalized.add(compiled);
    }
  });

  if (!normalized.size) {
    DEFAULT_DISTRACTION_DOMAINS.forEach((pattern) => {
      const compiled = normalizePattern(pattern);
      if (compiled && !disabled.has(compiled)) {
        normalized.add(compiled);
      }
    });
  }

  return { patterns: Array.from(normalized).sort(), upgraded: shouldUpgrade };
}

function persistBlocklistUpgrade(patterns: string[]) {
  if (upgradeInFlight) {
    return;
  }

  upgradeInFlight = true;
  mutateSettings((current) => ({
    ...current,
    blocklist: patterns,
    blocklistVersion: DEFAULT_BLOCKLIST_VERSION,
  }))
    .catch((error) => {
      console.error("Failed to persist blocklist upgrade", error);
    })
    .finally(() => {
      upgradeInFlight = false;
    });
}

function emit() {
  const state = currentState;
  if (!state) {
    return;
  }

  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("Site detector listener failed", error);
    }
  });
}

function updateState(settings: Settings, reason: string) {
  const { patterns, upgraded } = resolveBlocklist(settings);
  const serialized = JSON.stringify(patterns);
  const version = settings.blocklistVersion ?? DEFAULT_BLOCKLIST_VERSION;
  const effectiveVersion = upgraded ? DEFAULT_BLOCKLIST_VERSION : version;

  if (serialized === lastSerializedPatterns && currentState) {
    currentState = {
      ...currentState,
      version: effectiveVersion,
      updatedAtIso: new Date().toISOString(),
    };
    emit();
    if (upgraded) {
      persistBlocklistUpgrade(patterns);
    }
    return;
  }

  lastSerializedPatterns = serialized;
  compiledPatterns = patterns
    .map((pattern) => compilePattern(pattern))
    .filter((pattern): pattern is CompiledPattern => Boolean(pattern));

  currentState = {
    patterns,
    version: effectiveVersion,
    updatedAtIso: new Date().toISOString(),
  };

  console.debug("Site detector blocklist updated", {
    reason,
    patternCount: patterns.length,
    version,
  });

  if (upgraded) {
    persistBlocklistUpgrade(patterns);
  }

  emit();
}

function parseUrl(input: string | URL): URL | null {
  if (input instanceof URL) {
    return input;
  }

  try {
    return new URL(input);
  } catch (error) {
    try {
      return new URL(`https://${input}`);
    } catch {
      console.debug("Unable to parse URL for site detection", { input, error });
      return null;
    }
  }
}

export async function initializeSiteDetector(): Promise<BlocklistState> {
  if (initialized && currentState) {
    return currentState;
  }

  if (initializing) {
    return initializing;
  }

  initializing = getSettings()
    .then((settings) => {
      updateState(settings, "init");
      onSettingsChanged((next) => updateState(next, "settings-changed"));
      initialized = true;
      return currentState as BlocklistState;
    })
    .finally(() => {
      initializing = null;
    });

  return initializing;
}

export function getCurrentBlocklist(): BlocklistState | null {
  return currentState;
}

export function subscribeToBlocklist(listener: BlocklistListener) {
  listeners.add(listener);
  const state = currentState;
  if (state) {
    listener(state);
  }
  return () => listeners.delete(listener);
}

export function matchHost(host: string): SiteDetectionMatch {
  const normalizedHost = host.toLowerCase();

  for (const compiled of compiledPatterns) {
    if (matchesHost(normalizedHost, compiled)) {
      return {
        matched: true,
        pattern: compiled.pattern,
        host: normalizedHost,
        pathPattern: compiled.pathPattern,
      };
    }
  }

  return {
    matched: false,
    pattern: null,
    host: normalizedHost,
    pathPattern: null,
  };
}

export function matchUrl(input: string | URL): SiteDetectionMatch {
  const url = parseUrl(input);
  if (!url || !url.hostname) {
    return {
      matched: false,
      pattern: null,
      host: null,
      pathPattern: null,
    };
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();

  for (const compiled of compiledPatterns) {
    if (!matchesHost(host, compiled)) {
      continue;
    }

    if (!matchesPath(path, compiled)) {
      continue;
    }

    return {
      matched: true,
      pattern: compiled.pattern,
      host,
      pathPattern: compiled.pathPattern,
    };
  }

  return {
    matched: false,
    pattern: null,
    host,
    pathPattern: null,
  };
}

export async function refreshBlocklist(reason = "manual-refresh"): Promise<BlocklistState | null> {
  const settings = await getSettings();
  updateState(settings, reason);
  return currentState;
}

export function isDistractingUrl(input: string | URL): boolean {
  return matchUrl(input).matched;
}
