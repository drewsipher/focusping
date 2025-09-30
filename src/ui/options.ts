import { runtime } from "@/shared/chrome";
import {
  defaults,
  getSettings,
  mutateSettings,
  onSettingsChanged,
  type Mode,
  type Settings,
} from "@/shared/storage";

type FormSnapshot = {
  mode: Mode;
  schedule: {
    start: string;
    end: string;
    pausedOutsideSchedule: boolean;
  };
  reminder: {
    frequencyMinutes: number;
    snoozeMinutes: number;
    showGifs: boolean;
  };
};

const queryInput = <ElementType extends HTMLElement>(id: string) => {
  return document.getElementById(id) as ElementType | null;
};

let currentSettings: Settings | null = null;

function isMissingReceiverError(error: unknown) {
  return (
    error instanceof Error &&
    (/Receiving end does not exist/.test(error.message) ||
      /The message port closed before a response was received/.test(error.message))
  );
}

async function sendStateUpdateMessage() {
  try {
    await runtime.sendMessage({ type: "focus-ping::state-updated" });
  } catch (error) {
    if (isMissingReceiverError(error)) {
      console.debug("No runtime listeners for state update", error);
      return;
    }
    console.error("Failed to broadcast state update", error);
  }
}

function getFormElements() {
  return {
    modeInputs: Array.from(document.querySelectorAll<HTMLInputElement>("input[name='mode']")),
    scheduleStart: queryInput<HTMLInputElement>("schedule-start"),
    scheduleEnd: queryInput<HTMLInputElement>("schedule-end"),
    schedulePaused: queryInput<HTMLInputElement>("schedule-paused"),
    reminderFrequency: queryInput<HTMLInputElement>("reminder-frequency"),
    snoozeDuration: queryInput<HTMLInputElement>("snooze-duration"),
    gifToggle: queryInput<HTMLInputElement>("gif-toggle"),
    blocklistForm: queryInput<HTMLFormElement>("blocklist-form"),
    domainInput: queryInput<HTMLInputElement>("domain-input"),
    blocklistBody: queryInput<HTMLTableSectionElement>("blocklist-body"),
  };
}

function renderBlocklist(settings: Settings, body: HTMLTableSectionElement) {
  body.innerHTML = "";
  const disabledSet = new Set(settings.disabledBlocklist ?? []);
  const domains = [...settings.blocklist].sort((a, b) => a.localeCompare(b));

  if (domains.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 2;
    emptyCell.className = "blocklist-empty";
    emptyCell.textContent = "No distracting sites yet.";
    emptyRow.appendChild(emptyCell);
    body.appendChild(emptyRow);
    return;
  }

  domains.forEach((domain) => {
    const row = document.createElement("tr");
    const isDisabled = disabledSet.has(domain);
    row.dataset.disabled = isDisabled ? "true" : "false";

    const domainCell = document.createElement("td");
    domainCell.className = "blocklist-domain";
    domainCell.textContent = domain;

    const actionCell = document.createElement("td");
    actionCell.className = "blocklist-actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "blocklist-toggle";
    toggleButton.dataset.state = isDisabled ? "disabled" : "enabled";
    toggleButton.textContent = isDisabled ? "Enable" : "Disable";
    toggleButton.addEventListener("click", async () => {
      toggleButton.disabled = true;
      try {
        const updated = await mutateSettings((current) => {
          const disabled = new Set(current.disabledBlocklist ?? []);
          if (disabled.has(domain)) {
            disabled.delete(domain);
          } else {
            disabled.add(domain);
          }
          return {
            ...current,
            disabledBlocklist: Array.from(disabled),
          };
        });
        applySettingsToForm(updated);
        await sendStateUpdateMessage();
      } catch (error) {
        console.error("Failed to toggle blocklist domain", error);
      } finally {
        toggleButton.disabled = false;
      }
    });

    actionCell.appendChild(toggleButton);
    row.appendChild(domainCell);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

function applySettingsToForm(settings: Settings) {
  currentSettings = settings;
  const {
    modeInputs,
    scheduleStart,
    scheduleEnd,
    schedulePaused,
    reminderFrequency,
    snoozeDuration,
    gifToggle,
    blocklistBody,
  } = getFormElements();

  modeInputs.forEach((input) => {
    input.checked = input.value === settings.mode;
  });

  if (scheduleStart) scheduleStart.value = settings.schedule.start;
  if (scheduleEnd) scheduleEnd.value = settings.schedule.end;
  if (schedulePaused) schedulePaused.checked = Boolean(settings.schedule.pausedOutsideSchedule);

  if (reminderFrequency) reminderFrequency.value = String(settings.reminder.frequencyMinutes);
  if (snoozeDuration) snoozeDuration.value = String(settings.reminder.snoozeMinutes);
  if (gifToggle) gifToggle.checked = Boolean(settings.reminder.showGifs);

  if (blocklistBody) {
    renderBlocklist(settings, blocklistBody);
  }
}

function readSettingsFromForm(): FormSnapshot {
  const {
    modeInputs,
    scheduleStart,
    scheduleEnd,
    schedulePaused,
    reminderFrequency,
    snoozeDuration,
    gifToggle,
  } = getFormElements();

  const mode = (modeInputs.find((input) => input.checked)?.value as Mode | undefined) ?? "gentle";

  const safeNumber = (input: HTMLInputElement | null, fallback: number) => {
    if (!input) {
      return fallback;
    }

    const trimmed = input.value.trim();
    const candidate = Number.isNaN(input.valueAsNumber) ? undefined : input.valueAsNumber;
    const parsed = candidate ?? (trimmed ? Number.parseFloat(trimmed) : undefined);

    if (typeof parsed !== "number" || Number.isNaN(parsed)) {
      return fallback;
    }

    const min = input.min !== "" ? Number.parseFloat(input.min) : undefined;
    const max = input.max !== "" ? Number.parseFloat(input.max) : undefined;

    let clamped = parsed;
    if (typeof min === "number" && Number.isFinite(min)) {
      clamped = Math.max(clamped, min);
    }
    if (typeof max === "number" && Number.isFinite(max)) {
      clamped = Math.min(clamped, max);
    }

    return clamped;
  };

  const baselineReminder =
    currentSettings?.reminder.frequencyMinutes ?? defaults.settings.reminder.frequencyMinutes;
  const baselineSnooze =
    currentSettings?.reminder.snoozeMinutes ?? defaults.settings.reminder.snoozeMinutes;

  return {
    mode,
    schedule: {
      start: scheduleStart?.value || defaults.settings.schedule.start,
      end: scheduleEnd?.value || defaults.settings.schedule.end,
      pausedOutsideSchedule: Boolean(schedulePaused?.checked),
    },
    reminder: {
      frequencyMinutes: safeNumber(reminderFrequency, baselineReminder),
      snoozeMinutes: safeNumber(snoozeDuration, baselineSnooze),
      showGifs: Boolean(gifToggle?.checked),
    },
  };
}

async function persistSettings(event?: Event) {
  event?.preventDefault();
  const formValues = readSettingsFromForm();

  try {
    const updated = await mutateSettings((settings) => ({
      ...settings,
      mode: formValues.mode,
      schedule: {
        ...settings.schedule,
        ...formValues.schedule,
      },
      reminder: {
        ...settings.reminder,
        ...formValues.reminder,
      },
    }));

    applySettingsToForm(updated);
    await sendStateUpdateMessage();
  } catch (error) {
    console.error("Failed to persist settings", error);
    if (currentSettings) {
      applySettingsToForm(currentSettings);
    }
  }
}

async function handleBlocklistSubmit(event: SubmitEvent) {
  event.preventDefault();
  const { domainInput } = getFormElements();
  if (!domainInput) return;

  const raw = domainInput.value.trim();
  if (!raw) return;

  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const hostname = parsed.hostname.replace(/^www\./, "");

    const updated = await mutateSettings((settings) => {
      const alreadyPresent = settings.blocklist.includes(hostname);
      const blocklist = alreadyPresent ? settings.blocklist : [...settings.blocklist, hostname];

      return {
        ...settings,
        blocklist,
        disabledBlocklist: settings.disabledBlocklist.filter((domain) => domain !== hostname),
      };
    });

    applySettingsToForm(updated);
    domainInput.value = "";
    await sendStateUpdateMessage();
  } catch (error) {
    console.error("Invalid URL", error);
  }
}

async function bootstrap() {
  const initial = await getSettings();
  applySettingsToForm(initial);

  const elements = getFormElements();
  elements.modeInputs.forEach((input) => input.addEventListener("change", persistSettings));
  elements.scheduleStart?.addEventListener("change", persistSettings);
  elements.scheduleEnd?.addEventListener("change", persistSettings);
  elements.schedulePaused?.addEventListener("change", persistSettings);
  elements.reminderFrequency?.addEventListener("change", persistSettings);
  elements.snoozeDuration?.addEventListener("change", persistSettings);
  elements.gifToggle?.addEventListener("change", persistSettings);
  elements.blocklistForm?.addEventListener("submit", handleBlocklistSubmit);

  onSettingsChanged(applySettingsToForm);
}

bootstrap().catch(console.error);
