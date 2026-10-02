/**
 * deferred-tools: the web, background terminal, and workflow tools register
 * with `exposure: "deferred"`, so they stay out of the system prompt until
 * the model loads them with pi's built-in `tool_search`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOOL_SEARCH = "tool_search";

export default function deferredTools(pi: ExtensionAPI) {
  // MCP tools carry a namespace and are listed in pi's own MCP section.
  const deferredToolNames = () =>
    pi
      .getAllTools()
      .filter((tool) => tool.exposure === "deferred" && !tool.namespace)
      .map((tool) => tool.name);

  pi.on("session_start", (_event, ctx) => {
    // Headless children (subagents, workflow agents) run as SDK sessions
    // without pi's built-in tool_search, so they get every tool up front.
    const added = ctx.mode === "print" ? deferredToolNames() : [TOOL_SEARCH];
    pi.setActiveTools([...new Set([...pi.getActiveTools(), ...added])]);
  });

  // tool_search does not name the tools it can load, so the model would not
  // know to look for them. The list stays the same as tools load, which keeps
  // the system prompt stable.
  pi.on("before_agent_start", (event, ctx) => {
    if (ctx.mode === "print") return;
    const names = deferredToolNames();
    if (names.length === 0) return;
    event.systemPromptOptions.promptGuidelines.push(
      `These tools are deferred: ${names.join(", ")}. Load them with ${TOOL_SEARCH} before using them.`,
    );
  });
}
