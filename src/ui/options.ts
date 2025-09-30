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
    blocklist: queryInput<HTMLUListElement>("blocklist"),
  };
}

function renderBlocklist(items: string[], listEl: HTMLUListElement) {
  listEl.innerHTML = "";
  items.forEach((domain) => {
    const li = document.createElement("li");
    li.textContent = domain;

    const removeButton = document.createElement("button");
    removeButton.textContent = "Remove";
    removeButton.type = "button";
    removeButton.addEventListener("click", async () => {
      const updated = await mutateSettings((settings) => ({
        ...settings,
        blocklist: settings.blocklist.filter((value) => value !== domain),
      }));
      applySettingsToForm(updated);
    });

    li.appendChild(removeButton);
    listEl.appendChild(li);
  });
}

function applySettingsToForm(settings: Settings) {
  const {
    modeInputs,
    scheduleStart,
    scheduleEnd,
    schedulePaused,
    reminderFrequency,
    snoozeDuration,
    gifToggle,
    blocklist,
  } = getFormElements();

  modeInputs.forEach((input) => {
    input.checked = input.value === settings.mode;
  });

  if (scheduleStart) scheduleStart.value = settings.schedule.start;
  if (scheduleEnd) scheduleEnd.value = settings.schedule.end;
  if (schedulePaused) schedulePaused.checked = settings.schedule.pausedOutsideSchedule;
  if (reminderFrequency) reminderFrequency.valueAsNumber = settings.reminder.frequencyMinutes;
  if (snoozeDuration) snoozeDuration.valueAsNumber = settings.reminder.snoozeMinutes;
  if (gifToggle) gifToggle.checked = settings.reminder.showGifs;

  if (blocklist) {
    renderBlocklist(settings.blocklist, blocklist);
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
    const value = input?.valueAsNumber;
    return Number.isFinite(value) && value !== null ? (value as number) : fallback;
  };

  return {
    mode,
    schedule: {
      start: scheduleStart?.value || defaults.settings.schedule.start,
      end: scheduleEnd?.value || defaults.settings.schedule.end,
      pausedOutsideSchedule: Boolean(schedulePaused?.checked),
    },
    reminder: {
      frequencyMinutes: safeNumber(reminderFrequency, defaults.settings.reminder.frequencyMinutes),
      snoozeMinutes: safeNumber(snoozeDuration, defaults.settings.reminder.snoozeMinutes),
      showGifs: Boolean(gifToggle?.checked),
    },
  };
}

async function persistSettings(event?: Event) {
  event?.preventDefault();
  const formValues = readSettingsFromForm();
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
  await runtime.sendMessage({ type: "focus-ping::state-updated" });
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
      if (settings.blocklist.includes(hostname)) {
        return settings;
      }
      return {
        ...settings,
        blocklist: [...settings.blocklist, hostname],
      };
    });
    applySettingsToForm(updated);
    domainInput.value = "";
    await runtime.sendMessage({ type: "focus-ping::state-updated" });
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
