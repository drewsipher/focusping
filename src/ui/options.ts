type Mode = "gentle" | "strict";

type Settings = {
  mode: Mode;
  scheduleStart: string;
  scheduleEnd: string;
  reminderFrequency: number;
  snoozeDuration: number;
  showGifs: boolean;
  pausedOutsideSchedule: boolean;
  blocklist: string[];
};

const defaultSettings: Settings = {
  mode: "gentle",
  scheduleStart: "08:00",
  scheduleEnd: "18:00",
  reminderFrequency: 5,
  snoozeDuration: 10,
  showGifs: true,
  pausedOutsideSchedule: false,
  blocklist: [],
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

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(defaultSettings);
  const parsed: Settings = {
    ...defaultSettings,
    ...stored,
    blocklist: Array.isArray(stored.blocklist) ? stored.blocklist : defaultSettings.blocklist,
  };
  return parsed;
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
      const next = items.filter((value) => value !== domain);
      await chrome.storage.sync.set({ blocklist: next });
      renderBlocklist(next, listEl);
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

  if (scheduleStart) scheduleStart.value = settings.scheduleStart;
  if (scheduleEnd) scheduleEnd.value = settings.scheduleEnd;
  if (schedulePaused) schedulePaused.checked = settings.pausedOutsideSchedule;
  if (reminderFrequency) reminderFrequency.valueAsNumber = settings.reminderFrequency;
  if (snoozeDuration) snoozeDuration.valueAsNumber = settings.snoozeDuration;
  if (gifToggle) gifToggle.checked = settings.showGifs;

  if (blocklist) {
    renderBlocklist(settings.blocklist, blocklist);
  }
}

function readSettingsFromForm(): Settings {
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

  const mode = (modeInputs.find((input) => input.checked)?.value as Mode | undefined) ?? "gentle";

  return {
    mode,
    scheduleStart: scheduleStart?.value || defaultSettings.scheduleStart,
    scheduleEnd: scheduleEnd?.value || defaultSettings.scheduleEnd,
    pausedOutsideSchedule: !!schedulePaused?.checked,
    reminderFrequency: reminderFrequency?.valueAsNumber || defaultSettings.reminderFrequency,
    snoozeDuration: snoozeDuration?.valueAsNumber || defaultSettings.snoozeDuration,
    showGifs: !!gifToggle?.checked,
    blocklist: blocklist
      ? Array.from(blocklist.querySelectorAll("li")).map((item) => item.textContent ?? "")
      : defaultSettings.blocklist,
  };
}

async function saveSettings(event?: Event) {
  event?.preventDefault();
  const settings = readSettingsFromForm();
  await chrome.storage.sync.set(settings);
  chrome.runtime.sendMessage({ type: "focus-ping::state-updated" });
}

async function handleBlocklistSubmit(event: SubmitEvent) {
  event.preventDefault();
  const { domainInput } = getFormElements();
  if (!domainInput) return;

  const url = domainInput.value.trim();
  if (!url) return;

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const settings = await loadSettings();
    if (!settings.blocklist.includes(hostname)) {
      const next = [...settings.blocklist, hostname];
      await chrome.storage.sync.set({ blocklist: next });
      const elements = getFormElements();
      if (elements.blocklist) {
        renderBlocklist(next, elements.blocklist);
      }
    }
    domainInput.value = "";
  } catch (error) {
    console.error("Invalid URL", error);
  }
}

async function bootstrap() {
  const settings = await loadSettings();
  applySettingsToForm(settings);

  const elements = getFormElements();
  elements.modeInputs.forEach((input) => input.addEventListener("change", saveSettings));
  elements.scheduleStart?.addEventListener("change", saveSettings);
  elements.scheduleEnd?.addEventListener("change", saveSettings);
  elements.schedulePaused?.addEventListener("change", saveSettings);
  elements.reminderFrequency?.addEventListener("change", saveSettings);
  elements.snoozeDuration?.addEventListener("change", saveSettings);
  elements.gifToggle?.addEventListener("change", saveSettings);
  elements.blocklistForm?.addEventListener("submit", handleBlocklistSubmit);
}

bootstrap().catch(console.error);
