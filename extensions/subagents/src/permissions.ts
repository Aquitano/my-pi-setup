import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeUserConfig } from "../../shared/user-config.ts";

export const CLAUDE_MODES = [
  "auto",
  "acceptEdits",
  "dontAsk",
  "plan",
  "bypassPermissions",
] as const;
export const CODEX_MODES = ["auto", "sandbox", "full-access"] as const;
export const DEFAULT_SUBAGENT_PERMISSIONS = {
  claude: "auto",
  codex: "auto",
} as const;

function parseMode<const T extends string>(
  value: unknown,
  modes: readonly T[],
  field: string,
) {
  if (value === undefined) return modes[0];
  const mode = modes.find((candidate) => candidate === value);
  if (mode === undefined)
    throw new Error(`${field} must be one of: ${modes.join(", ")}`);
  return mode;
}

/** User-owned configuration, outside the package checkout and project settings. */
export function loadSubagentPermissions(agentDir = getAgentDir()) {
  const file = join(agentDir, "subagents.json");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return DEFAULT_SUBAGENT_PERMISSIONS;
    }
    throw new Error(`Cannot read ${file}`, { cause: error });
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected an object");
    }
    for (const key of Object.keys(value)) {
      if (key !== "claude" && key !== "codex")
        throw new Error(`Unknown setting: ${key}`);
    }
    return {
      claude: parseMode(
        "claude" in value ? value.claude : undefined,
        CLAUDE_MODES,
        "claude",
      ),
      codex: parseMode(
        "codex" in value ? value.codex : undefined,
        CODEX_MODES,
        "codex",
      ),
    };
  } catch (error) {
    throw new Error(
      `Invalid ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

export function claudePermissionOptions(mode: (typeof CLAUDE_MODES)[number]) {
  return {
    permissionMode: mode,
    permissionPrompts: "none",
    allowDangerouslySkipPermissions: mode === "bypassPermissions",
  } satisfies Pick<
    Options,
    "permissionMode" | "permissionPrompts" | "allowDangerouslySkipPermissions"
  >;
}

export function codexPermissionOptions(mode: (typeof CODEX_MODES)[number]) {
  return {
    sandbox: mode === "full-access" ? "danger-full-access" : "workspace-write",
    approvalPolicy: mode === "auto" ? "on-request" : "never",
    approvalsReviewer: mode === "auto" ? "auto_review" : "user",
  } as const;
}

export function saveSubagentPermissions(
  config: ReturnType<typeof loadSubagentPermissions>,
) {
  return writeUserConfig(join(getAgentDir(), "subagents.json"), config);
}
