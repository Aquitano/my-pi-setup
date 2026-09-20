import type { Theme } from "@earendil-works/pi-coding-agent";

export type ActivityState =
  "running" | "done" | "failed" | "pending" | "cancelled";

export const SQUARE = "■";
export const HOLLOW_SQUARE = "□";
export const POINTER = "❯";

const STATE_COLOR = {
  running: "warning",
  done: "success",
  failed: "error",
  pending: "muted",
  cancelled: "muted",
} as const;

export function stateColor(state: ActivityState) {
  return STATE_COLOR[state];
}

export function stateGlyph(theme: Theme, state: ActivityState) {
  return theme.fg(
    STATE_COLOR[state],
    state === "pending" ? HOLLOW_SQUARE : SQUARE,
  );
}

export function stateWord(
  theme: Theme,
  state: ActivityState,
  word: string = state,
) {
  return theme.fg(STATE_COLOR[state], word);
}
