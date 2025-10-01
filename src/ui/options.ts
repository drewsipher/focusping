import { runtime } from "@/shared/chrome";
import {
  defaults,
  getSettings,
  mutateSettings,
  onSettingsChanged,
  type Mode,
  type Settings,
} from "@/shared/storage";

type Elements = {
  modeInputs: HTMLInputElement[];
  scheduleStart: HTMLInputElement | null;
  scheduleEnd: HTMLInputElement | null;
  schedulePaused: HTMLInputElement | null;
  reminderFrequency: HTMLInputElement | null;
  snoozeDuration: HTMLInputElement | null;
  gifToggle: HTMLInputElement | null;
  blocklistForm: HTMLFormElement | null;
  domainInput: HTMLInputElement | null;
  blocklistBody: HTMLTableSectionElement | null;
  domainError: HTMLParagraphElement | null;
  gifPreview: HTMLDivElement | null;
  gifPreviewState: HTMLElement | null;
};

const query = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function collectElements(): Elements {
  return {
    modeInputs: Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']")),
    scheduleStart: query<HTMLInputElement>("schedule-start"),
    scheduleEnd: query<HTMLInputElement>("schedule-end"),
    schedulePaused: query<HTMLInputElement>("schedule-paused"),
    reminderFrequency: query<HTMLInputElement>("reminder-frequency"),
    snoozeDuration: query<HTMLInputElement>("snooze-duration"),
    gifToggle: query<HTMLInputElement>("gif-toggle"),
    blocklistForm: query<HTMLFormElement>("blocklist-form"),
    domainInput: query<HTMLInputElement>("domain-input"),
    blocklistBody: query<HTMLTableSectionElement>("blocklist-body"),
    domainError: query<HTMLParagraphElement>("domain-error"),
    gifPreview: query<HTMLDivElement>("gif-preview"),
    gifPreviewState: query<HTMLElement>("gif-preview-state"),
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

function updateGifPreview(showGifs: boolean) {
  if (elements.gifPreview) {
    elements.gifPreview.classList.toggle("gif-preview--off", !showGifs);
    elements.gifPreview.dataset.state = showGifs ? "on" : "off";
    elements.gifPreview.setAttribute(
      "aria-label",
      showGifs ? "Humorous GIF preview showing a vibrant overlay" : "Humorous GIF preview disabled",
    );
  }

  if (elements.gifPreviewState) {
    elements.gifPreviewState.textContent = showGifs ? "on" : "off";
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
    elements.reminderFrequency.value = String(settings.reminder.frequencyMinutes);
  }

  if (elements.snoozeDuration) {
    elements.snoozeDuration.value = String(settings.reminder.snoozeMinutes);
  }

  if (elements.gifToggle) {
    elements.gifToggle.checked = Boolean(settings.reminder.showGifs);
  }

  updateGifPreview(Boolean(settings.reminder.showGifs));
  renderBlocklist(settings);
  setDomainError(null);
}

function readMinutes(input: HTMLInputElement | null, fallback: number) {
  if (!input) {
    return fallback;
  }

  const trimmed = input.value.trim();
  let parsed = Number.isNaN(input.valueAsNumber) ? Number.NaN : input.valueAsNumber;

  if (Number.isNaN(parsed)) {
    parsed = trimmed ? Number.parseFloat(trimmed) : Number.NaN;
  }

  if (!Number.isFinite(parsed)) {
    parsed = fallback;
  }

  const min = input.min ? Number.parseFloat(input.min) : Number.NEGATIVE_INFINITY;
  const max = input.max ? Number.parseFloat(input.max) : Number.POSITIVE_INFINITY;

  const clamped = Math.min(Math.max(parsed, min), max);
  input.value = String(clamped);
  return clamped;
}

async function applyUpdate(updater: (settings: Settings) => Settings) {
  try {
    isApplying = true;
    const updated = await mutateSettings(updater);
    renderSettings(updated);
    await sendStateUpdateMessage();
  } catch (error) {
    console.error("Failed to update settings", error);
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

function handleReminderFrequencyChange() {
  const fallback =
    currentSettings?.reminder.frequencyMinutes ?? defaults.settings.reminder.frequencyMinutes;
  const minutes = readMinutes(elements.reminderFrequency, fallback);
  void applyUpdate((settings) => ({
    ...settings,
    reminder: {
      ...settings.reminder,
      frequencyMinutes: minutes,
    },
  }));
}

function handleSnoozeDurationChange() {
  const fallback =
    currentSettings?.reminder.snoozeMinutes ?? defaults.settings.reminder.snoozeMinutes;
  const minutes = readMinutes(elements.snoozeDuration, fallback);
  void applyUpdate((settings) => ({
    ...settings,
    reminder: {
      ...settings.reminder,
      snoozeMinutes: minutes,
    },
  }));
}

function handleGifToggleChange() {
  const showGifs = Boolean(elements.gifToggle?.checked);
  updateGifPreview(showGifs);
  void applyUpdate((settings) => ({
    ...settings,
    reminder: {
      ...settings.reminder,
      showGifs,
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
  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    // fall through
  }

  if (!hostname) {
    setDomainError("Please enter a valid domain.");
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
  elements.scheduleEnd?.addEventListener("change", handleScheduleEndChange);
  elements.schedulePaused?.addEventListener("change", handleSchedulePausedChange);
  elements.reminderFrequency?.addEventListener("change", handleReminderFrequencyChange);
  elements.snoozeDuration?.addEventListener("change", handleSnoozeDurationChange);
  elements.gifToggle?.addEventListener("change", handleGifToggleChange);
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
