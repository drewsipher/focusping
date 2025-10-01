export interface GentleInterventionPayload {
  domain: string;
  pattern: string | null;
  url: string;
  triggeredAtIso: string;
  repeatAfterMinutes: number;
}

export interface StrictInterventionPayload {
  domain: string;
  pattern: string | null;
  url: string;
  triggeredAtIso: string;
}

interface GentleOptions {
  snoozeMinutes: number;
  showGif: boolean;
  onDismiss: () => Promise<void>;
  onSnooze?: () => Promise<void>;
}

interface StrictOptions {
  snoozeMinutes: number;
  showGif: boolean;
  onSnooze: () => Promise<void>;
  onOpenNewTab?: () => Promise<void>;
}

const UI_STYLE = /* css */ `
  :host {
    all: initial;
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  .fp-banner,
  .fp-overlay {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483647;
    padding: 24px;
  }

  .fp-toast {
    pointer-events: auto;
    position: absolute;
    top: 24px;
    right: 24px;
    max-width: min(360px, calc(100vw - 32px));
    background: linear-gradient(135deg, rgba(134, 239, 172, 0.95), rgba(59, 130, 246, 0.95));
    border-radius: 20px;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.25);
    color: #0f172a;
    padding: 20px 24px;
    display: grid;
    gap: 12px;
    border: 1px solid rgba(15, 23, 42, 0.1);
    animation: fp-slide-in 220ms ease-out;
  }

  .fp-toast__header {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 0.8rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(15, 23, 42, 0.75);
  }

  .fp-toast__headline {
    margin: 0;
    font-size: 1.35rem;
    line-height: 1.1;
  }

  .fp-text-subtle {
    margin: 0;
    font-size: 0.95rem;
    color: rgba(15, 23, 42, 0.78);
  }

  .fp-toast__actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .fp-button {
    border: none;
    border-radius: 999px;
    padding: 10px 18px;
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    transition: transform 150ms ease, box-shadow 150ms ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 120px;
  }

  .fp-button:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.25);
  }

  .fp-button:disabled {
    opacity: 0.6;
    cursor: progress;
  }

  .fp-button--primary {
    background: #0f172a;
    color: #f9fafb;
  }

  .fp-button--ghost {
    background: rgba(15, 23, 42, 0.12);
    color: #0f172a;
  }

  .fp-toast__countdown {
    font-family: "JetBrains Mono", "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 0.85rem;
    padding: 6px 12px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.12);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    width: fit-content;
  }

  .fp-toast__visual {
    border-radius: 16px;
    background: linear-gradient(120deg, rgba(59, 130, 246, 0.6), rgba(244, 114, 182, 0.6));
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 2.25rem;
    animation: fp-wiggle 2.4s ease-in-out infinite;
  }

  .fp-overlay {
    background: linear-gradient(135deg, rgba(15, 23, 42, 0.88), rgba(79, 70, 229, 0.88));
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }

  .fp-overlay__card {
    background: rgba(248, 250, 252, 0.96);
    color: #111827;
    border-radius: 24px;
    padding: 32px;
    max-width: min(520px, calc(100vw - 48px));
    box-shadow: 0 24px 70px rgba(15, 23, 42, 0.4);
    display: grid;
    gap: 20px;
  }

  .fp-overlay__eyebrow {
    margin: 0;
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(79, 70, 229, 1);
  }

  .fp-overlay__headline {
    margin: 0;
    font-size: 2rem;
    line-height: 1.1;
  }

  .fp-overlay__visual {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 20px;
    background: linear-gradient(140deg, rgba(59, 130, 246, 0.55), rgba(249, 115, 22, 0.65));
    min-height: 160px;
    font-size: 3rem;
    animation: fp-float 4s ease-in-out infinite;
  }

  .fp-overlay__actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .fp-note {
    font-size: 0.9rem;
    color: rgba(15, 23, 42, 0.65);
    margin: 0;
  }

  .fp-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes fp-slide-in {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes fp-wiggle {
    0%,
    100% {
      transform: rotate(-4deg);
    }
    50% {
      transform: rotate(4deg);
    }
  }

  @keyframes fp-float {
    0%,
    100% {
      transform: translateY(-6px);
    }
    50% {
      transform: translateY(6px);
    }
  }

  @media (prefers-color-scheme: dark) {
    :host {
      color: #f9fafb;
    }

    .fp-toast {
      background: linear-gradient(135deg, rgba(59, 130, 246, 0.88), rgba(30, 64, 175, 0.94));
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.35);
    }

    .fp-toast__header {
      color: rgba(241, 245, 249, 0.75);
    }

    .fp-toast__countdown {
      background: rgba(15, 23, 42, 0.45);
      color: #f8fafc;
    }

    .fp-button--ghost {
      background: rgba(15, 23, 42, 0.35);
      color: #f8fafc;
    }

    .fp-overlay__card {
      background: rgba(15, 23, 42, 0.92);
      color: #f8fafc;
    }

    .fp-note {
      color: rgba(226, 232, 240, 0.75);
    }
  }
`;

const GENTLE_MESSAGES = [
  "Quick stretch, then back into flow?",
  "You're so close—let's finish the task first!",
  "Future you says thanks for staying on track.",
  "Deep breath. What's the one thing you meant to do?",
];

const STRICT_MESSAGES = [
  "This page is a distraction trap—escape while you can!",
  "Strict mode engaged: rescue your focus hero.",
  "Your goals called. They're waiting on another tab.",
  "Nothing changes if nothing changes. Let's pivot!",
];

const FRIENDLY_EMOJIS = ["🚀", "🧠", "🎧", "✨", "🛡️", "🔥"];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length) % items.length];
}

function formatCountdown(remainingMs: number) {
  if (remainingMs <= 0) {
    return "due any moment";
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

class GentleToast {
  private container: HTMLElement | null = null;
  private countdownEl: HTMLSpanElement | null = null;
  private countdownTimer: number | null = null;
  private dueAt: number | null = null;
  private messageEl: HTMLParagraphElement | null = null;
  private headlineEl: HTMLHeadingElement | null = null;
  private emojiEl: HTMLDivElement | null = null;
  private dismissButton: HTMLButtonElement | null = null;
  private snoozeButton: HTMLButtonElement | null = null;

  private ensureContainer(container: HTMLElement) {
    if (this.container) {
      return;
    }

    const banner = document.createElement("div");
    banner.className = "fp-banner";

    const toast = document.createElement("article");
    toast.className = "fp-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    const header = document.createElement("div");
    header.className = "fp-toast__header";
    header.innerHTML = `<span>Focus Ping</span>`;

    const headline = document.createElement("h2");
    headline.className = "fp-toast__headline";

    const message = document.createElement("p");
    message.className = "fp-text-subtle";

    const countdown = document.createElement("span");
    countdown.className = "fp-toast__countdown";

    const visual = document.createElement("div");
    visual.className = "fp-toast__visual";
    visual.setAttribute("aria-hidden", "true");

    const actions = document.createElement("div");
    actions.className = "fp-toast__actions";

    const dismiss = document.createElement("button");
    dismiss.className = "fp-button fp-button--primary";
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";

    const snooze = document.createElement("button");
    snooze.className = "fp-button fp-button--ghost";
    snooze.type = "button";

    actions.append(dismiss, snooze);
    toast.append(header, headline, message, countdown, visual, actions);
    banner.appendChild(toast);
    container.appendChild(banner);

    this.container = toast;
    this.countdownEl = countdown;
    this.messageEl = message;
    this.headlineEl = headline;
    this.emojiEl = visual;
    this.dismissButton = dismiss;
    this.snoozeButton = snooze;
  }

  hide() {
    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.container?.parentElement?.remove();
    this.container = null;
    this.countdownEl = null;
    this.messageEl = null;
    this.headlineEl = null;
    this.emojiEl = null;
    this.dismissButton = null;
    this.snoozeButton = null;
  }

  show(container: HTMLElement, payload: GentleInterventionPayload, options: GentleOptions) {
    this.ensureContainer(container);
    if (!this.container || !this.countdownEl || !this.messageEl || !this.headlineEl) {
      return;
    }

    if (this.emojiEl) {
      this.emojiEl.textContent = options.showGif ? pickRandom(FRIENDLY_EMOJIS) : "🎯";
      this.emojiEl.toggleAttribute("hidden", !options.showGif);
    }

    const playful = pickRandom(GENTLE_MESSAGES);
    this.headlineEl.textContent = "Quick refocus break";
    this.messageEl.innerHTML = `You're visiting <strong>${payload.domain}</strong>. ${playful}`;
    this.countdownEl.textContent = `Next reminder in ${payload.repeatAfterMinutes} min`;

    if (this.dismissButton) {
      this.dismissButton.onclick = async () => {
        this.dismissButton!.disabled = true;
        try {
          await options.onDismiss();
          this.hide();
        } catch (error) {
          console.error("Failed to dismiss gentle reminder", error);
        } finally {
          this.dismissButton && (this.dismissButton.disabled = false);
        }
      };
    }

    if (this.snoozeButton) {
      if (options.onSnooze) {
        this.snoozeButton.hidden = false;
        this.snoozeButton.textContent = `Snooze ${options.snoozeMinutes} min`;
        this.snoozeButton.onclick = async () => {
          this.snoozeButton!.disabled = true;
          try {
            await options.onSnooze?.();
            this.hide();
          } catch (error) {
            console.error("Failed to snooze from gentle toast", error);
          } finally {
            this.snoozeButton && (this.snoozeButton.disabled = false);
          }
        };
      } else {
        this.snoozeButton.hidden = true;
      }
    }

    const triggeredAt = Date.parse(payload.triggeredAtIso);
    const repeatMinutes = Math.max(1, payload.repeatAfterMinutes || 1);
    this.dueAt = triggeredAt + repeatMinutes * 60_000;
    this.updateCountdown();
    if (this.countdownTimer) {
      window.clearInterval(this.countdownTimer);
    }
    this.countdownTimer = window.setInterval(() => this.updateCountdown(), 1000);
  }

  private updateCountdown() {
    if (!this.countdownEl || !this.dueAt) {
      return;
    }
    const now = Date.now();
    const remaining = this.dueAt - now;
    this.countdownEl.textContent = `Next reminder in ${formatCountdown(remaining)}`;
  }
}

class StrictOverlay {
  private container: HTMLElement | null = null;
  private headlineEl: HTMLHeadingElement | null = null;
  private messageEl: HTMLParagraphElement | null = null;
  private emojiEl: HTMLDivElement | null = null;
  private noteEl: HTMLParagraphElement | null = null;
  private snoozeButton: HTMLButtonElement | null = null;

  private ensureContainer(container: HTMLElement) {
    if (this.container) {
      return;
    }

    const overlay = document.createElement("section");
    overlay.className = "fp-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const card = document.createElement("div");
    card.className = "fp-overlay__card";

    const eyebrow = document.createElement("p");
    eyebrow.className = "fp-overlay__eyebrow";
    eyebrow.textContent = "Strict mode";

    const headline = document.createElement("h1");
    headline.className = "fp-overlay__headline";
    headline.id = "fp-overlay-headline";

    const message = document.createElement("p");
    message.className = "fp-text-subtle";

    const visual = document.createElement("div");
    visual.className = "fp-overlay__visual";
    visual.setAttribute("aria-hidden", "true");

    const actions = document.createElement("div");
    actions.className = "fp-overlay__actions";

    const snooze = document.createElement("button");
    snooze.className = "fp-button fp-button--primary";
    snooze.type = "button";

    const note = document.createElement("p");
    note.className = "fp-note";

    actions.append(snooze);
    card.append(eyebrow, headline, message, visual, actions, note);
    overlay.appendChild(card);
    container.appendChild(overlay);

    this.container = overlay;
    this.headlineEl = headline;
    this.messageEl = message;
    this.emojiEl = visual;
    this.noteEl = note;
    this.snoozeButton = snooze;
  }

  hide() {
    this.container?.remove();
    this.container = null;
    this.headlineEl = null;
    this.messageEl = null;
    this.emojiEl = null;
    this.noteEl = null;
    this.snoozeButton = null;
    document.documentElement.style.removeProperty("overflow");
  }

  show(container: HTMLElement, payload: StrictInterventionPayload, options: StrictOptions) {
    this.ensureContainer(container);
    if (!this.container || !this.headlineEl || !this.messageEl || !this.noteEl) {
      return;
    }

    document.documentElement.style.setProperty("overflow", "hidden");

    if (this.emojiEl) {
      this.emojiEl.textContent = options.showGif ? pickRandom(FRIENDLY_EMOJIS) : "🛡️";
      this.emojiEl.toggleAttribute("hidden", !options.showGif);
    }

    this.headlineEl.textContent = `Focus rescue on ${payload.domain}`;
    this.messageEl.textContent = pickRandom(STRICT_MESSAGES);
    this.noteEl.textContent = "Switch to a productive tab or snooze the blocker temporarily.";

    if (this.snoozeButton) {
      this.snoozeButton.textContent = `Snooze ${options.snoozeMinutes} min`;
      this.snoozeButton.onclick = async () => {
        this.snoozeButton!.disabled = true;
        try {
          await options.onSnooze();
          this.hide();
        } catch (error) {
          console.error("Failed to snooze from strict overlay", error);
        } finally {
          this.snoozeButton && (this.snoozeButton.disabled = false);
        }
      };
    }

    if (this.container instanceof HTMLElement) {
      (this.container.querySelector(".fp-button") as HTMLButtonElement | null)?.focus({
        preventScroll: true,
      });
    }
  }
}

export class FocusPingUi {
  private host: HTMLDivElement | null = null;
  private readyPromise: Promise<HTMLDivElement> | null = null;
  private gentle = new GentleToast();
  private strict = new StrictOverlay();

  private ensureContainer(): Promise<HTMLDivElement> {
    if (this.host) {
      return Promise.resolve(this.host);
    }

    if (!this.readyPromise) {
      this.readyPromise = new Promise((resolve) => {
        const mount = () => {
          const host = document.createElement("div");
          host.id = "focus-ping-root";
          host.setAttribute("aria-hidden", "true");

          // Attach an open shadow root so our UI is isolated from page styles.
          const shadow = host.attachShadow({ mode: "open" });

          // Inject styles into the shadow root so :host and other selectors apply
          // inside the shadow and are isolated from page CSS.
          const style = document.createElement("style");
          style.id = "focus-ping-styles";
          style.textContent = UI_STYLE;
          shadow.appendChild(style);

          // Create an inner container inside the shadow where toasts/overlays mount.
          const inner = document.createElement("div");
          inner.id = "focus-ping-root-inner";
          shadow.appendChild(inner);

          document.body.appendChild(host);

          this.host = host;
          resolve(inner);
        };

        if (document.body) {
          mount();
        } else {
          document.addEventListener("DOMContentLoaded", mount, { once: true });
        }
      });
    }

    return this.readyPromise;
  }

  async showGentle(payload: GentleInterventionPayload, options: GentleOptions) {
    const container = await this.ensureContainer();
    // Make the host visible to assistive technology while the UI is shown so
    // focusing interactive elements (buttons) does not trigger the browser
    // warning about focusing an element hidden via aria-hidden.
    container.removeAttribute("aria-hidden");
    this.strict.hide();
    this.gentle.show(container, payload, options);
  }

  async showStrict(payload: StrictInterventionPayload, options: StrictOptions) {
    const container = await this.ensureContainer();
    // See comment in showGentle: ensure host is not aria-hidden when showing
    // an overlay that will focus its controls.
    container.removeAttribute("aria-hidden");
    this.gentle.hide();
    this.strict.show(container, payload, options);
  }

  clear() {
    this.gentle.hide();
    this.strict.hide();
    // Return the host to hidden for assistive technology when no UI is present.
    if (this.host) {
      this.host.setAttribute("aria-hidden", "true");
    }
  }
}
