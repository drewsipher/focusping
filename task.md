# Focus Ping Task Board

## 1. Foundation & Setup
- [x] **1.1 Initialize project scaffold**
  - [x] 1.1.1 Set up repository structure (`src/background`, `src/content`, `src/ui`, `public`).
  - [x] 1.1.2 Configure build tooling (Vite or webpack) for Chrome MV3 output.
  - [x] 1.1.3 Add TypeScript support with ESLint, Prettier, and path aliases.
  - [x] 1.1.4 Create base `manifest.json` with required permissions (`tabs`, `storage`, `notifications`, `alarms`).
- [ ] **1.2 Shared utilities groundwork**
  - [ ] 1.2.1 Implement Chrome API wrapper module (tabs, storage, alarms, notifications).
  - [ ] 1.2.2 Seed default settings schema and storage migration helpers.
  - [ ] 1.2.3 Establish theme tokens (colors, spacing, animation durations).

## 2. Core Runtime Development
- [ ] **2.1 Scheduler module**
  - [ ] 2.1.1 Model single daily focus window and pause toggle.
  - [ ] 2.1.2 Wire alarms for start/end of focus period.
  - [ ] 2.1.3 Broadcast focus state changes to listeners.
- [ ] **2.2 Site detection module**
  - [ ] 2.2.1 Implement wildcard domain matching (including subdomains).
  - [ ] 2.2.2 Load default blocklist and merge with user overrides.
  - [ ] 2.2.3 Expose change listener for live updates when blocklist changes.
- [ ] **2.3 Mode controller**
  - [ ] 2.3.1 Define gentle vs. strict logic branches.
  - [ ] 2.3.2 Handle repetition intervals and snooze expiry.
  - [ ] 2.3.3 Integrate with scheduler and site detector to avoid false positives.

## 3. User Interface & Interaction
- [ ] **3.1 Gentle toast UI**
  - [ ] 3.1.1 Build toast component with shadow DOM isolation.
  - [ ] 3.1.2 Add dismiss, repeat timer display, and accessibility labels.
  - [ ] 3.1.3 Style with vibrant theme and optional GIF slot.
- [ ] **3.2 Strict overlay UI**
  - [ ] 3.2.1 Create full-screen overlay with snooze + switch-tab prompts.
  - [ ] 3.2.2 Implement humorous GIF/message rotation with fallback static art.
  - [ ] 3.2.3 Ensure keyboard navigation and screen reader support.
- [ ] **3.3 Popup & status indicator**
  - [ ] 3.3.1 Design browser action popup layout (status, pause/resume, mode toggle).
  - [ ] 3.3.2 Display next reminder countdown and active schedule summary.
  - [ ] 3.3.3 Connect popup actions to background service worker via messaging.
- [ ] **3.4 Options page**
  - [ ] 3.4.1 Build settings form (mode, schedule, reminder frequency, snooze duration).
  - [ ] 3.4.2 Implement blocklist management UI (add/remove domains, validation).
  - [ ] 3.4.3 Add GIF/visual flair toggles with real-time preview.

## 4. Assets & Content
- [ ] **4.1 Curate humorous GIF pack and static fallback images (verify licensing).**
- [ ] **4.2 Write motivational copy variants for gentle and strict modes.**
- [ ] **4.3 Document localization strategy decision (MVP English only vs. roadmap).**

## 5. Testing & Quality
- [ ] **5.1 Configure automated tests (unit with Vitest/Jest, e2e with Puppeteer or Extension tester).**
- [ ] **5.2 Write unit tests for scheduler, site detector, and mode controller.**
- [ ] **5.3 Create manual QA checklist covering major distracting domains and schedule edges.**
- [ ] **5.4 Run accessibility audit on toast and overlay (Lighthouse or axe).**

## 6. Launch Preparation
- [ ] **6.1 Package signed MV3 build (Chrome `chrome://extensions` packaging).**
- [ ] **6.2 Draft Chrome Web Store listing copy, screenshots, and privacy statement.**
- [ ] **6.3 Verify store policy compliance (permissions, assets licensing, data handling).**
- [ ] **6.4 Plan post-launch telemetry placeholder activation steps.**
