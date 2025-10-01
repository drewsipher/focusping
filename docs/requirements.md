# Focus Ping Requirements

## 1. Product Overview
- **Product name:** FocusPing (Chrome extension)
- **Purpose:** Help students and professionals stay on task by detecting distracting websites and nudging them back to work.
- **Value proposition:** Lightweight, low-friction reminders that adapt to the user’s discipline level, while staying visually engaging and respectful of privacy.

## 2. Target Users and Use Cases
- **Primary users:** Knowledge workers and students who rely on web browsers to complete tasks.
- **Primary use cases:**
  - Working or studying from a laptop and drifting toward social media/streaming sites.
  - Maintaining productive focus blocks (e.g., Pomodoro sessions) during work hours.
  - Enforcing personal productivity rules without harsh blocking outside of work.

## 3. Goals and Success Metrics
- **MVP goal:** Release a working extension by *September 30, 2025* that reliably warns or blocks distracting sites during configured focus periods.
- **Success indicators:**
  - User stays focused (measured by reduced time spent on flagged sites during focus windows).
  - Positive qualitative feedback on usefulness and delight (eye-catching visuals, optional humor).
  - Track total installs/active users via Chrome Web Store dashboard; no in-extension telemetry for MVP.

## 4. Functional Requirements

### 4.1 Modes of Intervention
- **Gentle Mode:**
  - Shows a non-intrusive toast/notification when the user switches to a flagged tab.
  - Notification can be dismissed for the current visit/session.
  - Optional repetition at customizable intervals (e.g., every 5 minutes) unless dismissed.
- **Strict Mode:**
  - Displays a blocking overlay (or redirects to a local extension page) that prevents interaction with the distracting site.
  - User must switch to another tab or explicitly *Snooze* to proceed.
  - Snooze duration configurable (e.g., 5/10/15 minutes) and temporarily suppresses further interventions for that site.

### 4.2 Distracting Site Detection
- **Default blocklist:** TikTok, Instagram, Facebook, YouTube, Netflix, Prime Video, Disney+, Hulu, Reddit (extendable).
- **Pattern matching:** Domain-level matching with support for subdomains (e.g., `*.youtube.com`).
- **Customization:** Users can add/remove domains through an options page.
- **Storage:** Persist user settings using Chrome storage APIs.

### 4.3 Notifications and Escalation
- **Delivery mechanism:** Chrome notifications or in-page overlays that work on any site (avoid DOM conflicts by using shadow DOM or isolated iframe).
- **Visual design:** Eye-catching colors; optional humorous GIF or message that can be toggled per user preference.
- **Repetition:**
  - Gentle mode: repeat until dismissed.
  - Strict mode: block until snoozed or tab changed, with optional recurring reminder after snooze expires.

### 4.4 Scheduling and Focus Sessions
- **Working hours:** User-configurable focus schedule (e.g., weekdays 8 a.m.–6 p.m.).
- **Manual override:** Quick toggle to pause/resume focus monitoring.
- **Future-proofing:** Design schedule model to support multiple focus windows and one-off sessions.

### 4.5 Configuration Surface
- **Options page:**
  - Choose mode (Gentle vs. Strict).
  - Manage blocklist domains.
  - Configure schedule, snooze duration, and reminder frequency.
  - Toggle humorous GIFs/visual flair.
- **Browser action popup:** Quick status indicator, pause/resume, and shortcut to settings.

### 4.6 Accessibility
- Notifications adhere to accessibility guidelines (color contrast, screen reader labels, keyboard navigation).
- Provide text-only fallback if GIFs/animations are disabled.

## 5. User Experience Guidelines
- Use bold, high-contrast palettes that are attention-grabbing but not abrasive.
- Offer a rotation of motivational/funny copy or GIFs to make the reminder friendly.
- Ensure overlays/toasts never obscure critical browser UI (e.g., address bar) more than necessary.
- Keep interactions under 2 clicks for common actions (dismiss, snooze, switch mode).

## 6. Technical Requirements
- **Platform:** Chrome Extension Manifest V3.
- **Architecture:** Background service worker managing state & schedules; content scripts injected on matched domains to render overlays or notifications.
- **Permission scope:**
  - `tabs`, `storage`, `notifications`, `alarms` (for scheduling), host permissions for distracting domains.
- **State management:** Use Chrome storage sync/local as appropriate (sync for user preferences, local for session state).
- **Performance:** Minimal CPU impact; avoid long-running loops. Schedule checks via alarms and tab update listeners.
- **Security & privacy:**
  - All logic runs client-side.
  - No external analytics in MVP; rely on Chrome Web Store install metrics.
  - GIFs/visual assets bundled locally or served from trusted, privacy-safe sources.

## 7. Non-Functional Requirements
- **Reliability:** Notifications must trigger within 1 second of switching to a flagged tab during active focus time.
- **Usability:** Set-up flow guides users through choosing mode, schedule, and optional customization in under 2 minutes.
- **Maintainability:** Codebase organized for extension scaling (separate modules for detection, scheduling, UI components).
- **Portability:** Keep architecture adaptable to future browsers (Edge, Arc) where MV3-compatible.

## 8. MVP Scope (Today)
- Pre-set blocklist with user-configurable additions/removals.
- Gentle and Strict modes with baseline notification/overlay UI.
- Manual schedule configuration (single daily window) with option to pause.
- Options page + action popup for mode switching and quick controls.
- Local humorous GIF toggle (ship with default GIFs).

## 9. Future Enhancements
- Multiple schedules/focus sessions and Pomodoro integration.
- Remote analytics and anonymized usage metrics (opt-in).
- Advanced distraction heuristics (keyword detection, time-on-site thresholds).
- Integration with task managers or calendars.
- Shared/team focus modes or accountability buddies.
- Adaptive reminders based on productivity streaks.

## 10. Open Questions
- What source/licensing strategy should we use for GIFs and animated assets?
- Do we need localized copy for international users in the near term?
- Should we explore partnerships or distribution channels beyond the Chrome Web Store for discovery?

## 11. System Design Overview

### 11.1 High-Level Architecture
- **Background service worker** orchestrates schedules, tab state monitoring, mode selection, and storage access.
- **Content scripts** inject UI layers (toast overlay, strict blocker) into matching pages using shadow DOM to avoid CSS conflicts.
- **Options page** provides full configuration surface for blocklist, schedules, modes, GIF preferences, and repetition timing.
- **Browser action popup** surfaces quick controls (pause/resume, mode toggle, next reminder countdown) and links to settings.
- **Shared utility module** wraps Chrome APIs (`tabs`, `alarms`, `storage`, `notifications`) with typed helpers and guards.
- **Asset bundle** packages humorous GIFs, animation sprites, and fallback static assets.

### 11.2 Core Modules & Responsibilities
- `scheduler`: calculates active focus windows, sets alarms, emits focus state events.
- `site-detector`: matches current tab URLs against user-augmented blocklist; supports wildcard patterns.
- `mode-controller`: resolves intervention type (gentle/strict) and repetition cadence, respecting snooze state.
- `ui-layer`:
  - `gentle-toast`: renders dismissible notification toast; handles repeat timer and accessibility.
  - `strict-overlay`: presents full-screen overlay with snooze button, GIF, motivational copy.
- `storage-service`: abstracts Chrome storage sync/local separation, versioning schema, and migrations.
- `telemetry-placeholder`: stubs for future analytics hooks without transmitting data in MVP.

### 11.3 Data & State Model
- **User settings (sync storage):** blocklist array, mode selection, schedule definition, GIF toggle, reminder frequency, snooze durations.
- **Session state (local storage):** active snoozes by domain, last gentle reminder timestamp, pause state flag.
- **Derived in-memory state:** cached schedule result for current day, list of active content-script ports, asset preload manifest.

### 11.4 Key Flows
1. **Tab Activated:** `tabs.onActivated` → fetch URL → `site-detector` match → `scheduler` confirms focus window → `mode-controller` executes gentle or strict pathway.
2. **Reminder Repetition:** `mode-controller` schedules `alarms.create` for next interval → when alarm fires, revalidates focus context before re-rendering UI.
3. **Snooze:** User clicks snooze → session state records domain + expiry → `alarms` clears reminder until expiry.
4. **Schedule Update:** User edits schedule in options → `scheduler` recalculates upcoming alarms → propagates changes to service worker.
5. **Blocklist Mutation:** Options page updates domains → stored in sync → runtime message triggers content scripts to refresh match logic.

### 11.5 Technology Choices & Rationale
- **Manifest V3** service worker ensures compliance with Chrome store requirements and resource efficiency.
- **Shadow DOM-based overlays** guarantee styling isolation across distracting sites with heavy CSS.
- **Sass or CSS modules** (precompiled at build) to manage vibrant theme and animations consistently.
- **TypeScript** (recommended) to reduce runtime errors and ease module boundaries; can be downgraded to JS if time-constrained.
- **Vite or webpack-based build** to bundle TypeScript, styles, and assets into MV3-ready output with minimal overhead.

### 11.6 Risks & Mitigations
- **Race conditions on rapid tab switching:** Ensure debounced tab activation handling and cancel pending alarms when focus changes.
- **Strict overlay conflicts with site CSP:** Serve overlay from extension bundle, avoid inline scripts/styles, use DOM injection via content script.
- **Schedule accuracy across timezones:** Store schedule in local time with timezone-aware calculations; test DST transitions.
- **GIF performance/size:** Compress assets, provide static fallback when CPU usage spikes or user disables animations.
- **Accessibility compliance:** Test with keyboard-only navigation and screen readers; provide alt text for GIFs.

## 12. Task Breakdown (MVP Sprint)

### 12.1 Foundation
- Set up project scaffold (TypeScript, Vite/webpack, MV3 manifest, lint/test tooling).
- Implement shared Chrome API wrapper utilities.
- Define storage schema and default settings seed.

### 12.2 Core Features
- Build `site-detector` with wildcard domain matching and sync-storage integration.
- Implement `scheduler` with single daily window configuration and pause toggle.
- Create `mode-controller` handling gentle vs. strict logic, repetition, and snooze rules.

### 12.3 UI Delivery
- Develop gentle toast component with dismissal, repetition timer, and accessibility labels.
- Develop strict overlay with snooze controls, GIF slot, and motivational copy rotation.
- Style components with theme palette, animations, and responsive layout.

### 12.4 Configuration Surfaces
- Build options page for blocklist, schedule, mode, reminder settings, GIF toggle.
- Build browser action popup for quick controls and status overview.

### 12.5 QA & Polish
- Write integration tests for tab detection flow (using Chrome Extension testing harness or Puppeteer where feasible).
- Manual QA checklist across key distracting domains and schedule boundaries.
- Prepare Chrome Web Store assets: screenshots, promo copy, privacy statement.

### 12.6 Stretch (if time remains)
- Add humorous GIF pack selector and fallback static imagery.
- Prototype analytics hook that can be toggled on post-MVP.
