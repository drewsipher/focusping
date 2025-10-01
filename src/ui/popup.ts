// Minimal popup script for debugging. Logs when popup opens and when test buttons are clicked.

import { runtime } from "@/shared/chrome";

console.log("popup: script loaded");

const testGentle = document.getElementById("test-gentle");
const testStrict = document.getElementById("test-strict");

testGentle?.addEventListener("click", async () => {
  console.log("popup: test-gentle clicked — sending debug-trigger to background");
  try {
    const resp = await runtime.sendMessage({ type: "focus-ping::debug-trigger-intervention", payload: { kind: "gentle" } });
    console.log("popup: debug-trigger response:", resp);
  } catch (err) {
    console.error("popup: debug-trigger send failed", err);
  }
});

testStrict?.addEventListener("click", async () => {
  console.log("popup: test-strict clicked — sending debug-trigger to background");
  try {
    const resp = await runtime.sendMessage({ type: "focus-ping::debug-trigger-intervention", payload: { kind: "strict" } });
    console.log("popup: debug-trigger response:", resp);
  } catch (err) {
    console.error("popup: debug-trigger send failed", err);
  }
});

// Also log when popup opens (DOMContentLoaded)
window.addEventListener("DOMContentLoaded", () => {
  console.log("popup: DOMContentLoaded");
});
