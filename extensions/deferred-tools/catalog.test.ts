import assert from "node:assert/strict";
import test from "node:test";
import {
  loadedGroupsFromEntries,
  resolveGroups,
  withoutDeferredTools,
} from "./catalog.ts";

test("deferred tools are removed from the active set, loaders and core tools stay", () => {
  assert.deepEqual(
    withoutDeferredTools([
      "read",
      "bash",
      "search",
      "bg_start",
      "workflow",
      "rg",
      "load_tools",
      "subagent_spawn",
    ]),
    ["read", "bash", "rg", "load_tools", "subagent_spawn"],
  );
});

test("loading a group is additive and reports missing or active tools", () => {
  assert.deepEqual(
    resolveGroups(
      ["terminals", "web", "web"],
      ["bg_start", "bg_status", "bg_list", "bg_kill", "search"],
      ["read", "bg_list"],
    ),
    {
      added: ["bg_start", "bg_status", "bg_kill", "search"],
      alreadyActive: ["bg_list"],
      unavailable: ["scrape", "crawl"],
    },
  );
});

test("groups loaded earlier in the transcript are recovered from load_tools calls", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "hi" } },
    {
      type: "message",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "loading" },
          {
            type: "toolCall",
            id: "1",
            name: "load_tools",
            arguments: { groups: ["web", "bogus"] },
          },
          {
            type: "toolCall",
            id: "2",
            name: "rg",
            arguments: { pattern: "x" },
          },
        ],
      },
    },
    { type: "custom", message: undefined },
  ];
  assert.deepEqual(loadedGroupsFromEntries(entries), ["web"]);
});
