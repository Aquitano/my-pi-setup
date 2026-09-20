/**
 * deferred-tools: keeps rarely used tool groups out of the system prompt
 * until the model asks for them.
 *
 * At session start the tools listed in catalog.ts are deactivated. The
 * `load_tools` tool stays active and re-activates a group additively, which
 * pi turns into a native deferred-tool load where the provider supports it.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  describeCatalog,
  loadedGroupsFromEntries,
  resolveGroups,
  TOOL_GROUP_NAMES,
  withoutDeferredTools,
} from "./catalog.ts";

const LOADER_TOOL = "load_tools";

export default function deferredTools(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // Headless children (subagents, workflow agents) get every tool: a
    // one-shot child should not spend a turn on load_tools.
    if (ctx.mode === "print") return;
    const base = withoutDeferredTools(pi.getActiveTools());
    // Groups loaded earlier in this conversation stay loaded across
    // /reload, /resume, and /fork; a fresh session starts deferred.
    const loaded = loadedGroupsFromEntries(ctx.sessionManager.getBranch());
    const restored = resolveGroups(
      loaded,
      pi.getAllTools().map((tool) => tool.name),
      base,
    ).added;
    pi.setActiveTools([...new Set([...base, LOADER_TOOL, ...restored])]);
  });

  pi.registerTool({
    name: LOADER_TOOL,
    label: "Load Tools",
    description: `Activate a group of deferred tools for the rest of this session. Groups:\n${describeCatalog()}`,
    promptSnippet:
      "Activate deferred tool groups (web search/scrape, background terminals, workflows) before using them",
    promptGuidelines: [
      "Call load_tools before searching or scraping the web, starting a background terminal, or running a workflow; those tools are inactive until loaded.",
    ],
    parameters: Type.Object({
      groups: Type.Array(StringEnum(TOOL_GROUP_NAMES), {
        minItems: 1,
        description: "Tool groups to activate",
      }),
    }),
    async execute(_toolCallId, params) {
      const registered = pi.getAllTools().map((tool) => tool.name);
      const active = pi.getActiveTools();
      const result = resolveGroups(params.groups, registered, active);
      if (result.added.length > 0) {
        pi.setActiveTools([...new Set([...active, ...result.added])]);
      }
      const lines = [];
      if (result.added.length > 0)
        lines.push(`Activated: ${result.added.join(", ")}`);
      if (result.alreadyActive.length > 0)
        lines.push(`Already active: ${result.alreadyActive.join(", ")}`);
      if (result.unavailable.length > 0)
        lines.push(
          `Not installed in this setup: ${result.unavailable.join(", ")}`,
        );
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    },
    renderCall(args, theme) {
      const groups = Array.isArray(args.groups) ? args.groups.join(", ") : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("load_tools ")) +
          theme.fg("accent", groups),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const details = result.details as
        ReturnType<typeof resolveGroups> | undefined;
      const added = details?.added ?? [];
      return new Text(
        added.length > 0
          ? theme.fg("success", added.join(", "))
          : theme.fg("dim", "nothing new to activate"),
        0,
        0,
      );
    },
  });
}
