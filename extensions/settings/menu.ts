import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getAgentConcurrency,
  saveAgentLimit,
} from "../shared/agent-concurrency.ts";
import {
  CLAUDE_MODES,
  CODEX_MODES,
  DEFAULT_SUBAGENT_PERMISSIONS,
  loadSubagentPermissions,
  saveSubagentPermissions,
} from "../subagents/src/permissions.ts";
import {
  loadSummaryConfig,
  saveSummaryConfig,
  type SummaryConfig,
} from "../summaries/src/config.ts";

type SetupUi = Pick<ExtensionContext["ui"], "select" | "notify">;

const claudeChoices = {
  auto: "auto · automatic approval decisions",
  acceptEdits: "acceptEdits · approve file edits automatically",
  dontAsk: "dontAsk · deny requests that need approval",
  plan: "plan · planning permissions only",
  bypassPermissions: "bypassPermissions · unrestricted access",
} satisfies Record<(typeof CLAUDE_MODES)[number], string>;
const codexChoices = {
  auto: "auto · workspace sandbox with automatic approval review",
  sandbox: "sandbox · workspace writes, no escalation",
  "full-access": "full-access · no sandbox or approval prompts",
} satisfies Record<(typeof CODEX_MODES)[number], string>;
const limitChoices = Array.from({ length: 32 }, (_, index) =>
  String(index + 1),
);

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** A broken config file must not lock the user out of the menu that fixes it. */
function attempt<T>(load: () => T) {
  try {
    return { value: load(), error: undefined };
  } catch (error) {
    return { value: undefined, error: errorText(error) };
  }
}

async function pick<const T extends string>(
  ui: SetupUi,
  title: string,
  choices: Record<T, string>,
) {
  const keys = Object.keys(choices) as T[];
  const selected = await ui.select(
    title,
    keys.map((key) => choices[key]),
  );
  return keys.find((key) => choices[key] === selected);
}

export async function openSetup(
  ui: SetupUi,
  chooseSummary: (current: SummaryConfig) => Promise<SummaryConfig | undefined>,
) {
  let reported = false;
  while (true) {
    try {
      const permissions = attempt(loadSubagentPermissions);
      const pool = attempt(() => getAgentConcurrency().snapshot);
      const summary = loadSummaryConfig();
      if (!reported) {
        reported = true;
        for (const problem of [permissions.error, pool.error]) {
          if (problem) ui.notify(problem, "warning");
        }
      }
      const current = permissions.value ?? DEFAULT_SUBAGENT_PERMISSIONS;
      const capacity = pool.value
        ? `${pool.value.limit} (${pool.value.active} running, ${pool.value.waiting} waiting)`
        : "unreadable";
      const items = [
        {
          label: `Claude permissions · ${permissions.value?.claude ?? "unreadable"}`,
          edit: async () => {
            const mode = await pick(
              ui,
              "Claude permissions (applies to new subagents)",
              claudeChoices,
            );
            if (!mode) return false;
            await saveSubagentPermissions({ ...current, claude: mode });
            return true;
          },
        },
        {
          label: `Codex permissions · ${permissions.value?.codex ?? "unreadable"}`,
          edit: async () => {
            const mode = await pick(
              ui,
              "Codex permissions (applies to new subagents)",
              codexChoices,
            );
            if (!mode) return false;
            await saveSubagentPermissions({ ...current, codex: mode });
            return true;
          },
        },
        {
          label: `Concurrent agents · ${capacity}`,
          edit: async () => {
            const limit = await ui.select(
              "Shared agent limit (running agents finish first)",
              limitChoices,
            );
            if (!limit) return false;
            await saveAgentLimit(Number(limit));
            return true;
          },
        },
        {
          label: `Run recaps · ${summary.enabled === false ? "off" : "on"}`,
          edit: async () => {
            const choice = await ui.select(
              "Run recaps (applies to future completed runs)",
              ["On", "Off"],
            );
            if (!choice) return false;
            await saveSummaryConfig({ ...summary, enabled: choice === "On" });
            return true;
          },
        },
        {
          label: `Recap model · ${summary.provider}/${summary.model} · ${summary.reasoning}`,
          edit: async () => {
            const config = await chooseSummary(summary);
            if (!config) return false;
            await saveSummaryConfig(config);
            return true;
          },
        },
      ];
      const labels = items.map((item) => item.label);
      const selected = await ui.select("Pi setup", [...labels, "Close"]);
      const item = items[labels.indexOf(selected ?? "")];
      if (!item) return;
      if (await item.edit()) ui.notify("Setting saved.", "info");
    } catch (error) {
      ui.notify(`Could not update settings: ${errorText(error)}`, "error");
      return;
    }
  }
}
