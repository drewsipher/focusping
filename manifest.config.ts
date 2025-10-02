import { defineManifest } from "@crxjs/vite-plugin";

const manifest = defineManifest({
  manifest_version: 3,
  name: "FocusPing",
  description: "Stay focused by catching distracting tabs and nudging you back to work.",
  version: "0.1.0",
  action: {
    default_title: "FocusPing",
    default_popup: "src/ui/popup.html",
  },
  options_page: "src/ui/options.html",
  background: {
    service_worker: "src/background/main.ts",
    type: "module",
  },
  permissions: ["tabs", "storage", "notifications", "alarms", "scripting"],
  host_permissions: ["<all_urls>"],
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/main.ts"],
      run_at: "document_idle",
      type: "module",
    },
  ],
});

export default manifest;
