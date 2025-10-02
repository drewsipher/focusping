import { runtime } from "@/shared/chrome";
import {
  defaults,
  getSettings,
  onSettingsChanged,
  setSettings,
  type Mode,
  type Settings,
} from "@/shared/storage";

type Elements = {
  modeInputs: HTMLInputElement[];
  scheduleStart: HTMLInputElement | null;
  scheduleEnd: HTMLInputElement | null;
  schedulePaused: HTMLInputElement | null;
  reminderFrequency: HTMLInputElement | null;
  reminderValue: HTMLElement | null;
  blocklistForm: HTMLFormElement | null;
  domainInput: HTMLInputElement | null;
  blocklistBody: HTMLTableSectionElement | null;
  domainError: HTMLParagraphElement | null;
};

const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function collectElements(): Elements {
  return {
    modeInputs: Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']")),
    scheduleStart: query<HTMLInputElement>("schedule-start"),
    scheduleEnd: query<HTMLInputElement>("schedule-end"),
    schedulePaused: query<HTMLInputElement>("schedule-paused"),
    reminderFrequency: query<HTMLInputElement>("reminder-frequency"),
    reminderValue: query<HTMLElement>("reminder-value"),
    blocklistForm: query<HTMLFormElement>("blocklist-form"),
    domainInput: query<HTMLInputElement>("domain-input"),
    blocklistBody: query<HTMLTableSectionElement>("blocklist-body"),
    domainError: query<HTMLParagraphElement>("domain-error"),
  };
}

let elements: Elements;
let currentSettings: Settings | null = null;
let isApplying = false;

function isMissingReceiverError(error: unknown) {
  return (
    error instanceof Error &&
    (/Receiving end does not exist/.test(error.message) ||
      /The message port closed before a response was received/.test(error.message))
  );
}

async function sendStateUpdateMessage() {
  try {
    await runtime.sendMessage({ type: "focusping::state-updated" });
  } catch (error) {
    if (isMissingReceiverError(error)) {
      // No runtime listeners for state update — ignore
      return;
    }
    console.error("Failed to broadcast state update", error);
  }
}

function setDomainError(message: string | null) {
  if (!elements.domainError) {
    return;
  }

  if (message) {
    elements.domainError.textContent = message;
    elements.domainError.hidden = false;
  } else {
    elements.domainError.textContent = "";
    elements.domainError.hidden = true;
  }
}

function updateReminderValueDisplay(seconds: number) {
  if (!elements.reminderValue) return;
  
  if (seconds < 60) {
    elements.reminderValue.textContent = `${seconds} sec`;
  } else {
    const minutes = seconds / 60;
    if (minutes >= 1 && minutes % 1 === 0) {
      elements.reminderValue.textContent = `${minutes} min`;
    } else {
      elements.reminderValue.textContent = `${minutes.toFixed(1)} min`;
    }
  }
}

function renderBlocklist(settings: Settings) {
  const body = elements.blocklistBody;
  if (!body) {
    return;
  }

  body.innerHTML = "";
  const domains = [...settings.blocklist].sort((a, b) => a.localeCompare(b));
  const disabled = new Set(settings.disabledBlocklist ?? []);

  if (domains.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.className = "blocklist-empty";
    cell.textContent = "No distracting sites yet.";
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  domains.forEach((domain) => {
    const row = document.createElement("tr");
    const domainCell = document.createElement("td");
    domainCell.className = "blocklist-domain";
    domainCell.textContent = domain;

    const statusCell = document.createElement("td");
    statusCell.className = "blocklist-actions actions";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "blocklist-toggle";
    toggle.dataset.action = "toggle";
    toggle.dataset.domain = domain;
    const isDisabled = disabled.has(domain);
    toggle.dataset.state = isDisabled ? "disabled" : "enabled";
    toggle.textContent = isDisabled ? "Enable" : "Disable";
    statusCell.appendChild(toggle);

    const removeCell = document.createElement("td");
    removeCell.className = "actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "blocklist-remove";
    remove.dataset.action = "remove";
    remove.dataset.domain = domain;
    remove.textContent = "Remove";
    removeCell.appendChild(remove);

    row.dataset.disabled = isDisabled ? "true" : "false";
    row.appendChild(domainCell);
    row.appendChild(statusCell);
    row.appendChild(removeCell);
    body.appendChild(row);
  });
}

function renderSettings(settings: Settings) {
  currentSettings = settings;

  elements.modeInputs.forEach((input) => {
    input.checked = input.value === settings.mode;
  });

  if (elements.scheduleStart) {
    elements.scheduleStart.value = settings.schedule.start;
  }

  if (elements.scheduleEnd) {
    elements.scheduleEnd.value = settings.schedule.end;
  }

  if (elements.schedulePaused) {
    elements.schedulePaused.checked = Boolean(settings.schedule.pausedOutsideSchedule);
  }

  if (elements.reminderFrequency) {
    // Convert minutes to seconds for slider
    const seconds = Math.round(settings.reminder.frequencyMinutes * 60);
    elements.reminderFrequency.value = String(seconds);
    updateReminderValueDisplay(seconds);
  }

  renderBlocklist(settings);
  setDomainError(null);
}

function readMinutes(input: HTMLInputElement | null, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const value = input.value.trim();
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    // Reset to fallback on invalid input
    input.value = String(fallback);
    return fallback;
  }

  const min = input.min ? Number.parseFloat(input.min) : 0;
  const max = input.max ? Number.parseFloat(input.max) : Number.POSITIVE_INFINITY;

  const clamped = Math.min(Math.max(parsed, min), max);

  // Only update input if value was clamped
  if (clamped !== parsed) {
    input.value = String(clamped);
  }

  return clamped;
}

async function applyUpdate(updater: (settings: Settings) => Settings) {
  if (isApplying) {
    return;
  }

  try {
    isApplying = true;
    const updated = updater(currentSettings!);

    await setSettings(updated);

    currentSettings = updated;
    renderSettings(updated);

    await sendStateUpdateMessage();
  } catch (error) {
    console.error("Failed to save settings:", error);
    if (currentSettings) {
      renderSettings(currentSettings);
    }
  } finally {
    isApplying = false;
  }
}

function handleModeChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  if (!input || !input.checked) {
    return;
  }

  const nextMode = input.value as Mode;
  void applyUpdate((settings) => ({ ...settings, mode: nextMode }));
}

function handleScheduleStartChange() {
  const value = elements.scheduleStart?.value || defaults.settings.schedule.start;
  void applyUpdate((settings) => ({
    ...settings,
    schedule: {
      ...settings.schedule,
      start: value,
    },
  }));
}

function handleScheduleEndChange() {
  const value = elements.scheduleEnd?.value || defaults.settings.schedule.end;
  void applyUpdate((settings) => ({
    ...settings,
    schedule: {
      ...settings.schedule,
      end: value,
    },
  }));
}

function handleSchedulePausedChange() {
  const paused = Boolean(elements.schedulePaused?.checked);
  void applyUpdate((settings) => ({
    ...settings,
    schedule: {
      ...settings.schedule,
      pausedOutsideSchedule: paused,
    },
  }));
}

function handleReminderFrequencyChange(minutes: number) {
  void applyUpdate((settings) => ({
    ...settings,
    reminder: {
      ...settings.reminder,
      frequencyMinutes: minutes,
    },
  }));
}

async function handleBlocklistSubmit(event: SubmitEvent) {
  event.preventDefault();

  const input = elements.domainInput;
  if (!input) {
    return;
  }

  const raw = input.value.trim();
  if (!raw) {
    setDomainError("Enter a domain to add.");
    input.focus();
    return;
  }

  let hostname: string | null = null;
  
  // Try to parse as URL first
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    hostname = parsed.hostname;
  } catch {
    // If URL parsing fails, treat it as a plain domain
    // Clean it up: remove protocol, www, paths, etc.
    const cleaned = raw
      .replace(/^(https?:\/\/)?(www\.)?/i, "") // Remove protocol and www
      .replace(/\/.*$/, "") // Remove path
      .replace(/:\d+$/, "") // Remove port
      .toLowerCase();

    // Basic validation: should look like a domain
    if (
      cleaned &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(cleaned)
    ) {
      hostname = cleaned;
    }
  }

  // Remove www. prefix if present
  if (hostname) {
    hostname = hostname.replace(/^www\./, "").toLowerCase();
  }

  if (!hostname) {
    setDomainError("Please enter a valid domain (e.g., example.com)");
    input.focus();
    input.select();
    return;
  }

  if (currentSettings?.blocklist.includes(hostname)) {
    setDomainError("That domain is already on your list.");
    input.focus();
    input.select();
    return;
  }

  await applyUpdate((settings) => ({
    ...settings,
    blocklist: [...settings.blocklist, hostname],
    disabledBlocklist: settings.disabledBlocklist.filter((domain) => domain !== hostname),
  }));

  input.value = "";
  setDomainError(null);
}

function handleBlocklistClick(event: MouseEvent) {
  const target = (event.target as HTMLElement | null)?.closest("button");
  if (!target) {
    return;
  }

  const action = target.dataset.action as "toggle" | "remove" | undefined;
  const domain = target.dataset.domain;

  if (!action || !domain) {
    return;
  }

  target.disabled = true;

  const finalize = () => {
    target.disabled = false;
  };

  if (action === "toggle") {
    void applyUpdate((settings) => {
      const nextDisabled = new Set(settings.disabledBlocklist ?? []);
      if (nextDisabled.has(domain)) {
        nextDisabled.delete(domain);
      } else {
        nextDisabled.add(domain);
      }

      return {
        ...settings,
        disabledBlocklist: Array.from(nextDisabled),
      };
    }).finally(finalize);
    return;
  }

  void applyUpdate((settings) => ({
    ...settings,
    blocklist: settings.blocklist.filter((entry) => entry !== domain),
    disabledBlocklist: settings.disabledBlocklist.filter((entry) => entry !== domain),
  })).finally(finalize);
}

async function bootstrap() {
  elements = collectElements();

  const initial = await getSettings();
  renderSettings(initial);

  elements.modeInputs.forEach((input) => {
    input.addEventListener("change", handleModeChange);
  });

  elements.scheduleStart?.addEventListener("change", handleScheduleStartChange);
  elements.scheduleStart?.addEventListener("blur", handleScheduleStartChange);
  elements.scheduleStart?.addEventListener("input", handleScheduleStartChange);
  elements.scheduleEnd?.addEventListener("change", handleScheduleEndChange);
  elements.scheduleEnd?.addEventListener("blur", handleScheduleEndChange);
  elements.scheduleEnd?.addEventListener("input", handleScheduleEndChange);
  elements.schedulePaused?.addEventListener("change", handleSchedulePausedChange);
  
  // Reminder frequency slider - update display on input, save on change
  elements.reminderFrequency?.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    const seconds = parseInt(target.value, 10);
    updateReminderValueDisplay(seconds);
  });
  
  elements.reminderFrequency?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const seconds = parseInt(target.value, 10);
    const minutes = seconds / 60;
    handleReminderFrequencyChange(minutes);
  });
  
  elements.domainInput?.addEventListener("input", () => setDomainError(null));
  elements.blocklistForm?.addEventListener("submit", (event) => {
    handleBlocklistSubmit(event).catch(console.error);
  });
  elements.blocklistBody?.addEventListener("click", handleBlocklistClick);

  onSettingsChanged((settings) => {
    currentSettings = settings;
    if (!isApplying) {
      renderSettings(settings);
    }
  });
}

bootstrap().catch(console.error);
