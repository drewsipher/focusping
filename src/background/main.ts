import { action, runtime } from "@/shared/chrome";
import {
  getCurrentFocusState,
  initializeScheduler,
  subscribeToFocusState,
  type FocusState,
} from "./scheduler";
import { initializeSiteDetector, subscribeToBlocklist, type BlocklistState } from "./site-detector";
import { initializeModeController } from "./mode-controller";

const EXTENSION_NAME = "Focus Ping";
const HEARTBEAT_ALARM = "focus-ping::heartbeat";

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
    await runtime.sendMessage({ type: "focus-ping::focus-state", payload: state });
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
      type: "focus-ping::blocklist-updated",
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
});

chrome.runtime.onStartup.addListener(() => {
  console.info(`${EXTENSION_NAME} started`);
  const state = getCurrentFocusState();
  if (state) {
    handleFocusState(state);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    runtime.sendMessage({ type: "heartbeat" }).catch(() => {
      // No active listeners yet; safe to ignore.
    });
  }
});
