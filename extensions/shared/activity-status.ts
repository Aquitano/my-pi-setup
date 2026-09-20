import type { Theme } from "@earendil-works/pi-coding-agent";
import { stateGlyph } from "./glyphs.ts";

interface ActivityCounts {
  running: number;
  done: number;
  failed: number;
}

export function formatActivityStatus(
  theme: Theme,
  label: "subagents" | "workflows",
  counts: ActivityCounts,
) {
  const parts: string[] = [];
  if (counts.running > 0) {
    parts.push(
      `${stateGlyph(theme, "running")} ${theme.fg("warning", `${counts.running} running`)}`,
    );
  }
  if (counts.done > 0) {
    parts.push(
      `${stateGlyph(theme, "done")} ${theme.fg("success", `${counts.done} done`)}`,
    );
  }
  if (counts.failed > 0) {
    parts.push(
      `${stateGlyph(theme, "failed")} ${theme.fg("error", `${counts.failed} failed`)}`,
    );
  }
  parts.push(theme.fg("accent", `/${label}`) + theme.fg("dim", " to view"));

  return `${theme.fg("muted", `${label}:`)} ${parts.join(theme.fg("dim", " · "))}`;
}
