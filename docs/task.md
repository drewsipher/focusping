# Focus Ping Task Board

## 1. Foundation & Setup
- [x] **1.1 Initialize project scaffold**
  - [x] 1.1.1 Set up repository structure (`src/background`, `src/content`, `src/ui`, `public`).
  - [x] 1.1.2 Configure build tooling (Vite or webpack) for Chrome MV3 output.
  - [x] 1.1.3 Add TypeScript support with ESLint, Prettier, and path aliases.
  - [x] 1.1.4 Create base `manifest.json` with required permissions (`tabs`, `storage`, `notifications`, `alarms`).
- [x] **1.2 Shared utilities groundwork**
  - [x] 1.2.1 Implement Chrome API wrapper module (tabs, storage, alarms, notifications).
  - [x] 1.2.2 Seed default settings schema and storage migration helpers.
  - [x] 1.2.3 Establish theme tokens (colors, spacing, animation durations).

## 2. Core Runtime Development
- [x] **2.1 Scheduler module**
  - [x] 2.1.1 Model single daily focus window and pause toggle.
  - [x] 2.1.2 Wire alarms for start/end of focus period.
  - [x] 2.1.3 Broadcast focus state changes to listeners.
- [x] **2.2 Site detection module**
  - [x] 2.2.1 Implement wildcard domain matching (including subdomains).
  - [x] 2.2.2 Load default blocklist and merge with user overrides.
  - [x] 2.2.3 Expose change listener for live updates when blocklist changes.
- [x] **2.3 Mode controller**
  - [x] 2.3.1 Define gentle vs. strict logic branches.
  - [x] 2.3.2 Handle repetition intervals and snooze expiry.
  - [x] 2.3.3 Integrate with scheduler and site detector to avoid false positives.

## 3. User Interface & Interaction
- [x] **3.1 Gentle toast UI**
  - [x] 3.1.1 Build toast component with shadow DOM isolation.
  - [x] 3.1.2 Add dismiss, repeat timer display, and accessibility labels.
  - [x] 3.1.3 Style with vibrant theme and optional GIF slot.
- [x] **3.2 Strict overlay UI**
  - [x] 3.2.1 Create full-screen overlay with snooze + switch-tab prompts.
  - [x] 3.2.2 Implement humorous GIF/message rotation with fallback static art.
  - [x] 3.2.3 Ensure keyboard navigation and screen reader support.
- [x] **3.3 Popup & status indicator**
  - [x] 3.3.1 Design browser action popup layout (status, pause/resume, mode toggle).
  - [x] 3.3.2 Display next reminder countdown and active schedule summary.
  - [x] 3.3.3 Connect popup actions to background service worker via messaging.
- [x] **3.4 Options page**
  - [x] 3.4.1 Build settings form (mode, schedule, reminder frequency, snooze duration).
  - [x] 3.4.2 Implement blocklist management UI (add/remove domains, validation).
  - [x] 3.4.3 Add GIF/visual flair toggles with real-time preview.

## 4. Cleanup and robustness
- [x] **4.1 Simplify code, referring to the requirements document to make sure features that are implemented are still working, but code is as simple as possible.**
- [x] **4.2 Rename all references of "focus-ping" to focusping**
- [x] **4.3 Remove debugging console outputs**
- [x] **4.4 Run the linting and formatting and solve any addition issues**

## 5. Assets & Content
- [ ] **5.1 Curate humorous GIF pack and static fallback images.**
- [ ] **5.2 Write motivational copy variants for gentle and strict modes.**
- [ ] **5.3 Document localization strategy decision (MVP English only vs. roadmap).**

## 6. Testing & Quality
- [ ] **6.1 Configure automated tests (unit with Vitest/Jest, e2e with Puppeteer or Extension tester).**
- [ ] **6.2 Write unit tests for scheduler, site detector, and mode controller.**
- [ ] **6.3 Create manual QA checklist covering major distracting domains and schedule edges.**
- [ ] **6.4 Run accessibility audit on toast and overlay (Lighthouse or axe).**

## 7. Launch Preparation
- [ ] **7.1 Package signed MV3 build (Chrome `chrome://extensions` packaging).**
- [ ] **7.2 Draft Chrome Web Store listing copy, screenshots, and privacy statement.**
- [ ] **7.3 Verify store policy compliance (permissions, assets licensing, data handling).**
- [ ] **7.4 Plan post-launch telemetry placeholder activation steps.**
