import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-worktree-"));
const agentDir = path.join(tmp, "agent");
fs.mkdirSync(agentDir);
// The manager resolves the worktree root from the agent directory; point it
// at a temporary directory before pi's config module reads it. This is only
// safe because scripts/run-tests.mjs gives every test file its own process.
process.env.PI_CODING_AGENT_DIR = agentDir;

const { Effect, Layer, ManagedRuntime } = await import("effect");
const { BackendRegistry } = await import("./src/backend.ts");
const { makeStubBackend } = await import("./src/backends/stub.ts");
const { SubagentManager, SubagentManagerLive } =
  await import("./src/manager.ts");

function makeRepo() {
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  run(["add", "a.txt"]);
  run(["commit", "-q", "-m", "init"]);
  return repo;
}

test("isolated subagents run in their own worktree, removed on dispose when untouched", async (t) => {
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repo = makeRepo();
  const registry = Layer.sync(
    BackendRegistry,
    () =>
      new Map([
        [
          "claude" as const,
          makeStubBackend({
            backend: "claude",
            defaultModelLabel: "claude/sonnet",
            contextWindow: 200_000,
            toolName: "Bash",
            cadenceMs: 5,
          }),
        ],
      ]),
  );
  const runtime = ManagedRuntime.make(
    SubagentManagerLive.pipe(Layer.provide(registry)),
  );
  const manager = await runtime.runPromise(SubagentManager);

  const snap = await runtime.runPromise(
    manager.spawn("claude", {
      prompt: "hello",
      title: "Isolated task",
      cwd: repo,
      isolation: "worktree",
      parent: { parentCwd: repo, projectTrusted: true },
    }),
  );
  assert.ok(snap.worktree);
  assert.equal(snap.cwd, snap.worktree.path);
  assert.match(snap.worktree.branch, /^pi\/isolated-task-[0-9a-f]{4}$/);
  assert.ok(fs.existsSync(path.join(snap.cwd, "a.txt")));

  await runtime.runPromise(manager.waitFor([snap.id]));
  assert.ok(fs.existsSync(snap.cwd), "worktree survives until disposal");

  await runtime.dispose();
  assert.ok(!fs.existsSync(snap.cwd), "untouched worktree removed on dispose");
  assert.equal(snap.worktree, undefined, "snapshot forgets a removed worktree");
  const branches = execFileSync("git", ["branch", "--list", "pi/*"], {
    cwd: repo,
  }).toString();
  assert.equal(branches.trim(), "", "branch removed with the worktree");

  const plain = fs.mkdtempSync(path.join(tmp, "plain-"));
  const runtime2 = ManagedRuntime.make(
    SubagentManagerLive.pipe(Layer.provide(registry)),
  );
  const manager2 = await runtime2.runPromise(SubagentManager);
  const failed = await runtime2.runPromise(
    manager2
      .spawn("claude", {
        prompt: "hello",
        title: "no repo",
        cwd: plain,
        isolation: "worktree",
        parent: { parentCwd: plain, projectTrusted: true },
      })
      .pipe(Effect.flip),
  );
  assert.equal(failed._tag, "SpawnError");
  await runtime2.dispose();
});
