import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writeUserConfig } from "../../shared/user-config.ts";

export const REASONING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export interface SummaryConfig {
  readonly enabled?: boolean;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ReasoningLevel;
}

export const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  reasoning: "medium",
};

const extensionDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
export const PRIVATE_CONFIG_PATH = join(getAgentDir(), "summaries.json");
const LEGACY_CONFIG_PATH = join(extensionDirectory, "config.private.json");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isReasoningLevel = (value: unknown): value is ReasoningLevel =>
  typeof value === "string" &&
  REASONING_LEVELS.includes(value as ReasoningLevel);

export function parseSummaryConfig(value: unknown) {
  if (!isRecord(value)) return DEFAULT_SUMMARY_CONFIG;

  if (
    typeof value.provider !== "string" ||
    !value.provider.trim() ||
    typeof value.model !== "string" ||
    !value.model.trim() ||
    !isReasoningLevel(value.reasoning)
  ) {
    return DEFAULT_SUMMARY_CONFIG;
  }

  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    provider: value.provider.trim(),
    model: value.model.trim(),
    reasoning: value.reasoning,
  } satisfies SummaryConfig;
}

export function loadSummaryConfig() {
  for (const file of [PRIVATE_CONFIG_PATH, LEGACY_CONFIG_PATH]) {
    try {
      return parseSummaryConfig(JSON.parse(readFileSync(file, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      return DEFAULT_SUMMARY_CONFIG;
    }
  }
  return DEFAULT_SUMMARY_CONFIG;
}

export function saveSummaryConfig(config: SummaryConfig) {
  return writeUserConfig(PRIVATE_CONFIG_PATH, config);
}
