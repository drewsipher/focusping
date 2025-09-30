import { runtime } from "@/shared/chrome";
import {
  defaults,
  getSettings,
  onSettingsChanged,
  setSettings,
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
let isSaving = false;

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
    domainError: queryInput<HTMLParagraphElement>("domain-error"),
    gifPreview: queryInput<HTMLDivElement>("gif-preview"),
    gifPreviewState: queryInput<HTMLElement>("gif-preview-state"),
  };
}

function setDomainError(message: string | null) {
  const { domainError } = getFormElements();
  if (!domainError) {
    return;
  }

  domainError.textContent = message ?? "";
  domainError.hidden = !message;
}

function updateGifPreview(showGifs: boolean) {
  const { gifPreview, gifPreviewState } = getFormElements();

  if (gifPreview) {
    gifPreview.classList.toggle("gif-preview--off", !showGifs);
    gifPreview.dataset.state = showGifs ? "on" : "off";
    gifPreview.setAttribute(
      "aria-label",
      showGifs ? "Humorous GIF preview showing a vibrant overlay" : "Humorous GIF preview disabled",
    );
  }

  if (gifPreviewState) {
    gifPreviewState.textContent = showGifs ? "on" : "off";
  }
}

async function persistSettings(next: Settings) {
  try {
    isSaving = true;
    const updated = await setSettings(next);
    applySettingsToForm(updated);
    await sendStateUpdateMessage();
  } catch (error) {
    console.error("Failed to persist settings", error);
    if (currentSettings) {
      applySettingsToForm(currentSettings);
    }
  } finally {
    isSaving = false;
  }
}

function renderBlocklist(settings: Settings, body: HTMLTableSectionElement) {
  body.innerHTML = "";
  const disabledSet = new Set(settings.disabledBlocklist ?? []);
  const domains = [...settings.blocklist].sort((a, b) => a.localeCompare(b));

  if (domains.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 3;
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
    actionCell.className = "blocklist-actions actions";

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "blocklist-toggle";
    toggleButton.dataset.state = isDisabled ? "disabled" : "enabled";
    toggleButton.textContent = isDisabled ? "Enable" : "Disable";
    toggleButton.addEventListener("click", () => {
      toggleButton.disabled = true;
      handleToggleBlocklist(domain)
        .catch((error) => console.error("Failed to toggle blocklist domain", error))
        .finally(() => {
          toggleButton.disabled = false;
        });
    });

    actionCell.appendChild(toggleButton);
    const removeCell = document.createElement("td");
    removeCell.className = "actions";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "blocklist-remove";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      removeButton.disabled = true;
      handleRemoveFromBlocklist(domain)
        .catch((error) => console.error("Failed to remove blocklist domain", error))
        .finally(() => {
          removeButton.disabled = false;
        });
    });

    removeCell.appendChild(removeButton);
    row.appendChild(domainCell);
    row.appendChild(actionCell);
    row.appendChild(removeCell);
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

  updateGifPreview(Boolean(settings.reminder.showGifs));

  if (blocklistBody) {
    renderBlocklist(settings, blocklistBody);
  }

  setDomainError(null);
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

async function persistFormSnapshot() {
  if (!currentSettings) {
    return;
  }

  const snapshot = readSettingsFromForm();
  const next: Settings = {
    ...currentSettings,
    mode: snapshot.mode,
    schedule: {
      ...currentSettings.schedule,
      ...snapshot.schedule,
    },
    reminder: {
      ...currentSettings.reminder,
      ...snapshot.reminder,
    },
  };

  updateGifPreview(snapshot.reminder.showGifs);
  await persistSettings(next);
}

async function handleToggleBlocklist(domain: string) {
  if (!currentSettings) {
    return;
  }

  const disabled = new Set(currentSettings.disabledBlocklist ?? []);
  if (disabled.has(domain)) {
    disabled.delete(domain);
  } else {
    disabled.add(domain);
  }

  const next: Settings = {
    ...currentSettings,
    disabledBlocklist: Array.from(disabled),
  };

  await persistSettings(next);
}

async function handleRemoveFromBlocklist(domain: string) {
  if (!currentSettings) {
    return;
  }

  const next: Settings = {
    ...currentSettings,
    blocklist: currentSettings.blocklist.filter((entry) => entry !== domain),
    disabledBlocklist: currentSettings.disabledBlocklist.filter((entry) => entry !== domain),
  };

  await persistSettings(next);
}

async function handleBlocklistSubmit(event: SubmitEvent) {
  event.preventDefault();
  const { domainInput } = getFormElements();
  if (!currentSettings || !domainInput) {
    return;
  }

  setDomainError(null);
  const raw = domainInput.value.trim();
  if (!raw) {
    setDomainError("Enter a domain to add.");
    domainInput.focus();
    return;
  }

  try {
    const parsed = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (!hostname) {
      setDomainError("Please enter a valid domain.");
      domainInput.focus();
      return;
    }

    if (currentSettings.blocklist.includes(hostname)) {
      setDomainError("That domain is already on your list.");
      domainInput.focus();
      return;
    }

    const next: Settings = {
      ...currentSettings,
      blocklist: [...currentSettings.blocklist, hostname],
      disabledBlocklist: currentSettings.disabledBlocklist.filter((domain) => domain !== hostname),
    };

    await persistSettings(next);
    domainInput.value = "";
    setDomainError(null);
  } catch (error) {
    console.error("Invalid URL", error);
    setDomainError("Please enter a valid domain.");
    domainInput.focus();
    domainInput.select();
  }
}

function registerEventHandlers() {
  const elements = getFormElements();
  elements.modeInputs.forEach((input) =>
    input.addEventListener("change", () => {
      persistFormSnapshot().catch(console.error);
    }),
  );
  elements.scheduleStart?.addEventListener("change", () => {
    persistFormSnapshot().catch(console.error);
  });
  elements.scheduleEnd?.addEventListener("change", () => {
    persistFormSnapshot().catch(console.error);
  });
  elements.schedulePaused?.addEventListener("change", () => {
    persistFormSnapshot().catch(console.error);
  });
  elements.reminderFrequency?.addEventListener("change", () => {
    persistFormSnapshot().catch(console.error);
  });
  elements.snoozeDuration?.addEventListener("change", () => {
    persistFormSnapshot().catch(console.error);
  });
  elements.gifToggle?.addEventListener("change", () => {
    updateGifPreview(Boolean(elements.gifToggle?.checked));
    persistFormSnapshot().catch(console.error);
  });
  elements.domainInput?.addEventListener("input", () => {
    setDomainError(null);
  });
  elements.blocklistForm?.addEventListener("submit", (event) => {
    handleBlocklistSubmit(event).catch(console.error);
  });
}

async function bootstrap() {
  const initial = await getSettings();
  applySettingsToForm(initial);

  registerEventHandlers();

  onSettingsChanged((settings) => {
    if (isSaving) {
      currentSettings = settings;
      return;
    }
    applySettingsToForm(settings);
  });
}

bootstrap().catch(console.error);
