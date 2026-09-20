export const TOOL_GROUPS = {
  web: {
    tools: ["search", "scrape", "crawl"],
    summary: "Firecrawl web search, page scraping, and site crawling",
  },
  terminals: {
    tools: ["bg_start", "bg_status", "bg_list", "bg_kill"],
    summary:
      "Background terminals for dev servers, watchers, and other long-running commands",
  },
  workflows: {
    tools: ["workflow"],
    summary:
      "Multi-agent workflow orchestration from an inline script (only when the user asks for a workflow or says 'ultracode')",
  },
} as const;

export type ToolGroup = keyof typeof TOOL_GROUPS;

export const TOOL_GROUP_NAMES = Object.keys(TOOL_GROUPS) as ToolGroup[];

function isToolGroup(value: unknown): value is ToolGroup {
  return typeof value === "string" && value in TOOL_GROUPS;
}

interface SessionEntryLike {
  type: string;
  message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Groups activated by load_tools calls recorded in the session transcript. */
export function loadedGroupsFromEntries(entries: readonly SessionEntryLike[]) {
  const groups = new Set<ToolGroup>();
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "assistant") continue;
    const content = entry.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!isRecord(part) || part.type !== "toolCall") continue;
      if (part.name !== "load_tools" || !isRecord(part.arguments)) continue;
      const requested = part.arguments.groups;
      if (!Array.isArray(requested)) continue;
      for (const group of requested) if (isToolGroup(group)) groups.add(group);
    }
  }
  return [...groups];
}

const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(TOOL_GROUPS).flatMap((group) => group.tools),
);

export function withoutDeferredTools(activeTools: readonly string[]) {
  return activeTools.filter((name) => !DEFERRED_TOOL_NAMES.has(name));
}

export function resolveGroups(
  groups: readonly ToolGroup[],
  registeredTools: readonly string[],
  activeTools: readonly string[],
) {
  const registered = new Set(registeredTools);
  const active = new Set(activeTools);
  const added: string[] = [];
  const alreadyActive: string[] = [];
  const unavailable: string[] = [];
  for (const group of new Set(groups)) {
    for (const tool of TOOL_GROUPS[group].tools) {
      if (!registered.has(tool)) unavailable.push(tool);
      else if (active.has(tool)) alreadyActive.push(tool);
      else added.push(tool);
    }
  }
  return { added, alreadyActive, unavailable };
}

export function describeCatalog() {
  return TOOL_GROUP_NAMES.map(
    (name) =>
      `${name}: ${TOOL_GROUPS[name].summary} (${TOOL_GROUPS[name].tools.join(", ")})`,
  ).join("\n");
}
