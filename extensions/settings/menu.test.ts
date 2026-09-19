import assert from "node:assert/strict";
import test, { after } from "node:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dir = mkdtempSync(join(tmpdir(), "pi-settings-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = dir;
const { openSetup } = await import("./menu.ts");
after(() => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  rmSync(dir, { recursive: true, force: true });
});

function menu(answers: Array<string | undefined>) {
  const notices: string[] = [];
  const ui: Parameters<typeof openSetup>[0] = {
    select: async (_title, options) => {
      const answer = answers.shift();
      if (answer === undefined) return undefined;
      const selected = options.find((option) => option.startsWith(answer));
      assert.ok(selected, `Missing menu option: ${answer}`);
      return selected;
    },
    notify: (message) => {
      notices.push(message);
    },
  };
  return { ui, notices };
}

test("closing or cancelling a picker writes nothing", async () => {
  const { ui } = menu(["Claude permissions", undefined, "Close"]);
  await openSetup(ui, async () => undefined);
  assert.deepEqual(readdirSync(dir), []);
});

test("settings menu persists permissions, live capacity, and recap preferences", async () => {
  const { ui, notices } = menu([
    "Claude permissions",
    "Don't ask",
    "Codex permissions",
    "Sandbox",
    "Concurrent agents",
    "2",
    "Run recaps",
    "Off",
    "Recap model",
    "Close",
  ]);
  await openSetup(ui, async (current) => ({
    ...current,
    model: "test-model",
    reasoning: "low",
  }));
  assert.equal(notices.length, 5);
  assert.ok(notices.every((message) => message === "Setting saved."));
  const read = (name: string) =>
    JSON.parse(readFileSync(join(dir, name), "utf8"));
  assert.deepEqual(read("subagents.json"), {
    claude: "dontAsk",
    codex: "sandbox",
  });
  assert.deepEqual(read("concurrency.json"), { maxRunning: 2 });
  assert.deepEqual(read("summaries.json"), {
    enabled: false,
    provider: "openai-codex",
    model: "test-model",
    reasoning: "low",
  });
  assert.equal(statSync(join(dir, "subagents.json")).mode & 0o777, 0o600);
  assert.equal(
    readdirSync(dir).some((name) => name.endsWith(".tmp")),
    false,
  );
  const { getAgentConcurrency } =
    await import("../shared/agent-concurrency.ts");
  assert.equal(getAgentConcurrency().snapshot.limit, 2);
});

test("malformed user settings report the file without overwriting it", async () => {
  const file = join(dir, "subagents.json");
  writeFileSync(file, '{"codex":"typo"}');
  const { ui, notices } = menu(["Close"]);
  await openSetup(ui, async () => undefined);
  assert.equal(notices.length, 1);
  assert.match(
    notices[0]!,
    /Could not update settings: Invalid .*subagents.json/,
  );
  assert.equal(readFileSync(file, "utf8"), '{"codex":"typo"}');
});
