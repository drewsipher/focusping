import { runtime, tabs } from "@/shared/chrome";
import { getSettings, setSettings, type Mode, type Settings } from "@/shared/storage";
import type { FocusState } from "@/shared/focus-state";

interface Elements {
  statusIndicator: HTMLElement | null;
  statusTitle: HTMLElement | null;
  statusMessage: HTMLElement | null;
  modeGentle: HTMLInputElement | null;
  modeStrict: HTMLInputElement | null;
  reminderFrequency: HTMLInputElement | null;
  reminderValue: HTMLElement | null;
  addSiteButton: HTMLButtonElement | null;
  openOptionsButton: HTMLButtonElement | null;
  addSiteModal: HTMLElement | null;
  modalSiteInfo: HTMLElement | null;
  addExactUrlButton: HTMLButtonElement | null;
  addBaseDomainButton: HTMLButtonElement | null;
  cancelAddButton: HTMLButtonElement | null;
}

let elements: Elements;
let currentSettings: Settings | null = null;
let currentTab: chrome.tabs.Tab | null = null;
let isCurrentTabOnWatchlist = false;

function collectElements(): Elements {
  return {
    statusIndicator: document.getElementById("status-indicator"),
    statusTitle: document.getElementById("status-title"),
    statusMessage: document.getElementById("status-message"),
    modeGentle: document.getElementById("mode-gentle") as HTMLInputElement | null,
    modeStrict: document.getElementById("mode-strict") as HTMLInputElement | null,
    reminderFrequency: document.getElementById("reminder-frequency") as HTMLInputElement | null,
    reminderValue: document.getElementById("reminder-value"),
    addSiteButton: document.getElementById("add-site") as HTMLButtonElement | null,
    openOptionsButton: document.getElementById("open-options") as HTMLButtonElement | null,
    addSiteModal: document.getElementById("add-site-modal"),
    modalSiteInfo: document.getElementById("modal-site-info"),
    addExactUrlButton: document.getElementById("add-exact-url") as HTMLButtonElement | null,
    addBaseDomainButton: document.getElementById("add-base-domain") as HTMLButtonElement | null,
    cancelAddButton: document.getElementById("cancel-add") as HTMLButtonElement | null,
  };
}

function getStatusInfo(
  focusState: FocusState | null,
  settings: Settings | null,
): { status: string; title: string; message: string } {
  if (!focusState || !settings) {
    return {
      status: "loading",
      title: "Loading...",
      message: "Checking your focus status",
    };
  }

  if (focusState.status === "manually-paused") {
    return {
      status: "paused",
      title: "Monitoring Paused",
      message: "Focus monitoring is manually paused",
    };
  }

  if (focusState.status === "outside-schedule") {
    return {
      status: "paused",
      title: "Outside Schedule",
      message: "You're outside your focus window",
    };
  }

  if (focusState.status === "snoozed") {
    return {
      status: "snoozed",
      title: "Snoozed",
      message: "Current site is snoozed",
    };
  }

  // Check if the current tab is on the watchlist
  if (!isCurrentTabOnWatchlist) {
    return {
      status: "idle",
      title: "Not Monitoring",
      message: "Current site is not on your watch list",
    };
  }

  if (!focusState.isMonitoring) {
    return {
      status: "idle",
      title: "Not Monitoring",
      message: "Current site is not on your watch list",
    };
  }

  return {
    status: "active",
    title: "Actively Monitoring",
    message: `Watching for distractions in ${settings.mode} mode`,
  };
}

function updateStatus(focusState: FocusState | null, settings: Settings | null) {
  const info = getStatusInfo(focusState, settings);

  if (elements.statusIndicator) {
    elements.statusIndicator.setAttribute("data-status", info.status);
  }

  if (elements.statusTitle) {
    elements.statusTitle.textContent = info.title;
  }

  if (elements.statusMessage) {
    elements.statusMessage.textContent = info.message;
  }
}

function updateControls(settings: Settings) {
  if (elements.modeGentle) {
    elements.modeGentle.checked = settings.mode === "gentle";
  }

  if (elements.modeStrict) {
    elements.modeStrict.checked = settings.mode === "strict";
  }

  if (elements.reminderFrequency) {
    // Convert minutes to seconds for the slider
    const seconds = Math.round(settings.reminder.frequencyMinutes * 60);
    elements.reminderFrequency.value = String(seconds);
  }

  updateReminderValueFromSeconds(Math.round(settings.reminder.frequencyMinutes * 60));
}

function updateReminderValueFromSeconds(seconds: number) {
  if (elements.reminderValue) {
    if (seconds < 60) {
      elements.reminderValue.textContent = `${seconds} sec`;
    } else {
      const minutes = seconds / 60;
      elements.reminderValue.textContent = `${minutes.toFixed(1)} min`;
    }
  }
}

function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return null;
  }
}

function extractBaseDomain(hostname: string): string {
  const parts = hostname.split(".");
  if (parts.length >= 2) {
    return parts.slice(-2).join(".");
  }
  return hostname;
}

function isUrlOnWatchlist(url: string | undefined, blocklist: string[]): boolean {
  if (!url) return false;

  const domain = extractDomain(url);
  if (!domain) return false;

  // Check if domain or any parent domain matches the blocklist
  for (const entry of blocklist) {
    // Exact match
    if (domain === entry) return true;

    // Wildcard match (e.g., *.example.com matches subdomain.example.com)
    if (entry.startsWith("*.")) {
      const baseDomain = entry.substring(2);
      if (domain === baseDomain || domain.endsWith("." + baseDomain)) {
        return true;
      }
    }

    // Check if domain ends with the entry (for subdomain matching)
    if (domain.endsWith("." + entry)) {
      return true;
    }
  }

  return false;
}

function showAddSiteModal() {
  if (!currentTab || !currentTab.url) {
    return;
  }

  const domain = extractDomain(currentTab.url);
  if (!domain) {
    return;
  }

  const baseDomain = extractBaseDomain(domain);

  if (elements.modalSiteInfo) {
    elements.modalSiteInfo.innerHTML = `
      <strong>Current site:</strong> ${domain}<br>
      <strong>Base domain:</strong> ${baseDomain}
    `;
  }

  if (elements.addSiteModal) {
    elements.addSiteModal.hidden = false;
  }
}

function hideAddSiteModal() {
  if (elements.addSiteModal) {
    elements.addSiteModal.hidden = true;
  }
}

async function addDomainToBlocklist(domain: string) {
  if (!currentSettings) return;

  const blocklist = [...currentSettings.blocklist];
  if (!blocklist.includes(domain)) {
    blocklist.push(domain);
    const updated = {
      ...currentSettings,
      blocklist,
    };
    await setSettings(updated);
    currentSettings = updated;
  }

  hideAddSiteModal();
}

async function handleModeChange(mode: Mode) {
  if (!currentSettings) return;

  const updated = {
    ...currentSettings,
    mode,
  };
  await setSettings(updated);
  currentSettings = updated;
}

async function handleReminderFrequencyChange(minutes: number) {
  if (!currentSettings) return;

  const updated = {
    ...currentSettings,
    reminder: {
      ...currentSettings.reminder,
      frequencyMinutes: minutes,
    },
  };
  await setSettings(updated);
  currentSettings = updated;
  const seconds = Math.round(minutes * 60);
  updateReminderValueFromSeconds(seconds);

  // Notify background to reset timers with new frequency
  try {
    await chrome.runtime.sendMessage({
      type: "focusping::frequency-changed",
      payload: { frequencyMinutes: minutes },
    });
  } catch (error) {
    console.error("Failed to notify background of frequency change:", error);
  }
}

async function loadFocusState(): Promise<FocusState | null> {
  try {
    const response = await runtime.sendMessage<{ type: string }, FocusState>({
      type: "focusping::get-focus-state",
    });
    return response || null;
  } catch (error) {
    console.error("Failed to load focus state:", error);
    return null;
  }
}

async function bootstrap() {
  elements = collectElements();

  try {
    currentSettings = await getSettings();
    const activeTab = await tabs.getActive();
    currentTab = activeTab || null;

    // Check if current tab is on the watchlist
    if (currentSettings && currentTab?.url) {
      isCurrentTabOnWatchlist = isUrlOnWatchlist(currentTab.url, currentSettings.blocklist);

      // Update add site button state
      if (elements.addSiteButton) {
        if (isCurrentTabOnWatchlist) {
          elements.addSiteButton.disabled = true;
          elements.addSiteButton.title = "This site is already being watched";
        } else {
          elements.addSiteButton.disabled = false;
          elements.addSiteButton.title = "Add this site to your watch list";
        }
      }
    }

    const focusState = await loadFocusState();

    if (currentSettings) {
      updateControls(currentSettings);
      updateStatus(focusState, currentSettings);
    }
  } catch (error) {
    console.error("Failed to initialize popup:", error);
  }

  elements.modeGentle?.addEventListener("change", () => {
    if (elements.modeGentle?.checked) {
      void handleModeChange("gentle");
    }
  });

  elements.modeStrict?.addEventListener("change", () => {
    if (elements.modeStrict?.checked) {
      void handleModeChange("strict");
    }
  });

  elements.reminderFrequency?.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement;
    const seconds = parseInt(target.value, 10);
    updateReminderValueFromSeconds(seconds);
  });

  elements.reminderFrequency?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    const seconds = parseInt(target.value, 10);
    const minutes = seconds / 60;
    void handleReminderFrequencyChange(minutes);
  });

  elements.addSiteButton?.addEventListener("click", () => {
    showAddSiteModal();
  });

  elements.openOptionsButton?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  elements.addExactUrlButton?.addEventListener("click", async () => {
    if (currentTab?.url) {
      const domain = extractDomain(currentTab.url);
      if (domain) {
        await addDomainToBlocklist(domain);
      }
    }
  });

  elements.addBaseDomainButton?.addEventListener("click", async () => {
    if (currentTab?.url) {
      const domain = extractDomain(currentTab.url);
      if (domain) {
        const baseDomain = extractBaseDomain(domain);
        await addDomainToBlocklist(baseDomain);
      }
    }
  });

  elements.cancelAddButton?.addEventListener("click", () => {
    hideAddSiteModal();
  });

  elements.addSiteModal?.querySelector(".modal__overlay")?.addEventListener("click", () => {
    hideAddSiteModal();
  });
}

bootstrap().catch(console.error);
