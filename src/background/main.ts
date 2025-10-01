import { action, runtime, tabs } from "@/shared/chrome";
import {
  getCurrentFocusState,
  initializeScheduler,
  subscribeToFocusState,
  type FocusState,
} from "./scheduler";
import { initializeSiteDetector, subscribeToBlocklist, type BlocklistState } from "./site-detector";
import { initializeModeController } from "./mode-controller";

const EXTENSION_NAME = "Focus Ping";
const HEARTBEAT_ALARM = "focusping::heartbeat";

const BADGE_LOOKUP: Record<FocusState["status"], { text: string; color: string }> = {
  active: { text: "ON", color: "#16a34a" },
  "manually-paused": { text: "OFF", color: "#f97316" },
  "outside-schedule": { text: "—", color: "#9ca3af" },
  snoozed: { text: "Zz", color: "#0ea5e9" },
};

async function applyBadgeState(state: FocusState) {
  const { text, color } = BADGE_LOOKUP[state.status];
  try {
    if (state.isMonitoring) {
      await action.setBadgeText(text);
      await action.setBadgeBackgroundColor({ color });
    } else {
      await action.setBadgeText("");
    }
  } catch (error) {
    console.error("Failed to update action badge", error);
  }
}

async function broadcastFocusState(state: FocusState) {
  try {
    await runtime.sendMessage({ type: "focusping::focus-state", payload: state });
  } catch (error) {
    if (error instanceof Error && /Receiving end does not exist/.test(error.message)) {
      return;
    }
    console.debug("No active listeners for focus-state broadcast", error);
  }
}

function handleFocusState(state: FocusState) {
  void applyBadgeState(state);
  void broadcastFocusState(state);
}

async function broadcastBlocklist(state: BlocklistState, reason: string) {
  try {
    await runtime.sendMessage({
      type: "focusping::blocklist-updated",
      payload: {
        patterns: state.patterns,
        updatedAtIso: state.updatedAtIso,
        version: state.version,
        reason,
      },
    });
  } catch (error) {
    if (error instanceof Error && /Receiving end does not exist/.test(error.message)) {
      return;
    }
    console.debug("No active listeners for blocklist broadcast", error);
  }
}

initializeSiteDetector()
  .then((state) => broadcastBlocklist(state, "init"))
  .catch((error) => {
    console.error("Failed to initialize site detector", error);
  });

subscribeToBlocklist((state) => {
  void broadcastBlocklist(state, "update");
});

initializeModeController().catch((error) => {
  console.error("Failed to initialize mode controller", error);
});

initializeScheduler()
  .then((state) => {
    if (state) {
      handleFocusState(state);
    }
  })
  .catch((error) => {
    console.error("Failed to initialize focus scheduler", error);
  });

subscribeToFocusState(handleFocusState);

chrome.runtime.onInstalled.addListener(() => {
  console.info(`${EXTENSION_NAME} installed`);
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  // Attempt to inject content scripts into existing tabs on install.
  void injectContentIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(() => {
  console.info(`${EXTENSION_NAME} started`);
  const state = getCurrentFocusState();
  if (state) {
    handleFocusState(state);
  }
  // Attempt to inject content scripts into existing tabs on startup.
  void injectContentIntoOpenTabs();
});

// Proactively inject the content script into all existing tabs where we have
// host permission. This helps avoid the common race on fresh install where
// content scripts aren't present in already-open tabs.
async function injectContentIntoOpenTabs() {
  try {
    const allTabs = await tabs.query({});
    for (const t of allTabs) {
      const tabId = t.id;
      if (typeof tabId !== "number") continue;

      const url = t.url ?? t.pendingUrl;
      if (!url || !/^https?:/i.test(url)) continue;

      let origin: string;
      try {
        origin = new URL(url).origin;
      } catch {
        continue;
      }

      const hasHostPerm = await new Promise<boolean>((resolve) => {
        if (!chrome.permissions || typeof chrome.permissions.contains !== "function") {
          resolve(false);
          return;
        }
        try {
          chrome.permissions.contains({ origins: [origin + "/*"] }, (granted: boolean) =>
            resolve(Boolean(granted)),
          );
        } catch (e) {
          resolve(false);
        }
      });

      if (!hasHostPerm) continue;

      try {
        if (chrome.scripting && typeof chrome.scripting.executeScript === "function") {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["content.js"],
          });
        }
      } catch (err) {
        console.debug(
          "Failed to inject content script into tab",
          tabId,
          err instanceof Error ? err.message : err,
        );
      }
    }
  } catch (err) {
    console.debug(
      "Failed to enumerate tabs for injection",
      err instanceof Error ? err.message : err,
    );
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    runtime.sendMessage({ type: "heartbeat" }).catch(() => {
      // No active listeners yet; safe to ignore.
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "focusping::get-focus-state") {
    const state = getCurrentFocusState();
    sendResponse(state);
    return true;
  }
});
