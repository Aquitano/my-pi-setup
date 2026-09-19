import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getAgentConcurrency,
  saveAgentLimit,
} from "../shared/agent-concurrency.ts";
import {
  CLAUDE_MODES,
  CODEX_MODES,
  loadSubagentPermissions,
  saveSubagentPermissions,
} from "../subagents/src/permissions.ts";
import {
  loadSummaryConfig,
  saveSummaryConfig,
  type SummaryConfig,
} from "../summaries/src/config.ts";

const claudeChoices = {
  auto: "Auto — automatic approval decisions",
  acceptEdits: "Accept edits — automatically approve file edits",
  dontAsk: "Don't ask — deny requests that need approval",
  plan: "Plan — planning permissions",
  bypassPermissions: "Bypass permissions — unrestricted access",
} satisfies Record<(typeof CLAUDE_MODES)[number], string>;
const codexChoices = {
  auto: "Auto — workspace sandbox and automatic approval review",
  sandbox: "Sandbox — workspace writes, no escalation",
  "full-access": "Full access — no sandbox or approval prompts",
} satisfies Record<(typeof CODEX_MODES)[number], string>;

export async function openSetup(
  ui: Pick<ExtensionContext["ui"], "select" | "notify">,
  chooseSummary: (current: SummaryConfig) => Promise<SummaryConfig | undefined>,
) {
  while (true) {
    try {
      const permissions = loadSubagentPermissions();
      const summary = loadSummaryConfig();
      const pool = getAgentConcurrency().snapshot;
      const options = [
        `Claude permissions · ${permissions.claude}`,
        `Codex permissions · ${permissions.codex}`,
        `Concurrent agents · ${pool.limit} (${pool.active} running, ${pool.waiting} waiting)`,
        `Run recaps · ${summary.enabled === false ? "off" : "on"}`,
        `Recap model · ${summary.provider}/${summary.model} · ${summary.reasoning}`,
        "Close",
      ];
      const selection = await ui.select("Pi setup", options);
      if (selection === undefined || selection === "Close") return;
      switch (options.indexOf(selection)) {
        case 0: {
          const selected = await ui.select(
            "Claude permissions — applies to new subagents",
            CLAUDE_MODES.map((mode) => claudeChoices[mode]),
          );
          const mode = CLAUDE_MODES.find(
            (mode) => claudeChoices[mode] === selected,
          );
          if (!mode) continue;
          await saveSubagentPermissions({
            ...loadSubagentPermissions(),
            claude: mode,
          });
          break;
        }
        case 1: {
          const selected = await ui.select(
            "Codex permissions — applies to new subagents",
            CODEX_MODES.map((mode) => codexChoices[mode]),
          );
          const mode = CODEX_MODES.find(
            (mode) => codexChoices[mode] === selected,
          );
          if (!mode) continue;
          await saveSubagentPermissions({
            ...loadSubagentPermissions(),
            codex: mode,
          });
          break;
        }
        case 2: {
          const selected = await ui.select(
            "Shared agent limit — existing work can finish",
            Array.from({ length: 32 }, (_, index) => String(index + 1)),
          );
          if (selected === undefined) continue;
          await saveAgentLimit(Number(selected));
          break;
        }
        case 3: {
          const selected = await ui.select(
            "Run recaps — applies to future completed runs",
            ["On", "Off"],
          );
          if (selected === undefined) continue;
          await saveSummaryConfig({
            ...loadSummaryConfig(),
            enabled: selected === "On",
          });
          break;
        }
        case 4: {
          const config = await chooseSummary(summary);
          if (!config) continue;
          await saveSummaryConfig({ ...loadSummaryConfig(), ...config });
          break;
        }
        default:
          return;
      }
      ui.notify("Setting saved.", "info");
    } catch (error) {
      ui.notify(
        `Could not update settings: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return;
    }
  }
}
