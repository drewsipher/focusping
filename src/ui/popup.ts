// Minimal popup script for debugging. Logs when popup opens and when test buttons are clicked.

import { runtime } from "@/shared/chrome";

// popup script loaded

const testGentle = document.getElementById("test-gentle");
const testStrict = document.getElementById("test-strict");
const openOptions = document.getElementById("open-options");

testGentle?.addEventListener("click", async () => {
  try {
    await runtime.sendMessage({
      type: "focusping::debug-trigger-intervention",
      payload: { kind: "gentle" },
    });
  } catch (err) {
    console.error("popup: debug-trigger send failed", err);
  }
});

testStrict?.addEventListener("click", async () => {
  try {
    await runtime.sendMessage({
      type: "focusping::debug-trigger-intervention",
      payload: { kind: "strict" },
    });
  } catch (err) {
    console.error("popup: debug-trigger send failed", err);
  }
});

openOptions?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Also log when popup opens (DOMContentLoaded)
window.addEventListener("DOMContentLoaded", () => {
  // popup DOMContentLoaded
});
