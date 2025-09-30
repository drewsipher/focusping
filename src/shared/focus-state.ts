import type { FocusStatus } from "@/shared/focus-window";

export interface FocusState {
  status: FocusStatus;
  isFocusWindow: boolean;
  isMonitoring: boolean;
  windowStartIso: string;
  windowEndIso: string;
  nextStartIso: string;
  nextEndIso: string;
  nextTransitionIso: string | null;
  timezone: string;
  evaluatedAtIso: string;
}
