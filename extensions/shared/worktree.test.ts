import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  createWorktree,
  gitEnv,
  removeWorktreeIfUnchanged,
} from "./worktree.ts";

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-"));
  const repo = path.join(dir, "repo");
  fs.mkdirSync(repo);
  const run = (args: string[]) =>
    execFileSync("git", args, { cwd: repo, stdio: "ignore", env: gitEnv() });
  run(["init", "-q", "-b", "main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "test"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  run(["add", "a.txt"]);
  run(["commit", "-q", "-m", "init"]);
  return { dir, repo, agentDir: path.join(dir, "agent") };
}

test("worktree is created on its own branch and removed when unchanged", async (t) => {
  const { dir, repo, agentDir } = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await createWorktree({
    cwd: repo,
    name: "Review auth",
    agentDir,
  });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const { worktree } = result;
  assert.match(worktree.branch, /^pi\/review-auth-[0-9a-f]{4}$/);
  assert.ok(worktree.path.startsWith(path.join(agentDir, "worktrees")));
  assert.ok(fs.existsSync(path.join(worktree.path, "a.txt")));

  assert.deepEqual(await removeWorktreeIfUnchanged(worktree), {
    removed: true,
  });
  assert.ok(!fs.existsSync(worktree.path));
  const branches = execFileSync("git", ["branch", "--list", worktree.branch], {
    cwd: repo,
    env: gitEnv(),
  }).toString();
  assert.equal(branches.trim(), "");
});

test("worktree with edits is kept for the parent to inspect", async (t) => {
  const { dir, repo, agentDir } = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await createWorktree({ cwd: repo, name: "edit", agentDir });
  assert.ok(result.ok, result.ok ? "" : result.error);
  fs.writeFileSync(path.join(result.worktree.path, "b.txt"), "b\n");

  assert.deepEqual(await removeWorktreeIfUnchanged(result.worktree), {
    removed: false,
  });
  assert.ok(fs.existsSync(result.worktree.path));
});

test("non-repository directories are rejected", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-plain-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = await createWorktree({ cwd: dir, name: "x", agentDir: dir });
  assert.equal(result.ok, false);
});

test("committed work keeps the worktree even with a clean status", async (t) => {
  const { dir, repo, agentDir } = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await createWorktree({ cwd: repo, name: "commit", agentDir });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const cwd = result.worktree.path;
  fs.writeFileSync(path.join(cwd, "c.txt"), "c\n");
  execFileSync("git", ["add", "c.txt"], { cwd, env: gitEnv() });
  execFileSync("git", ["commit", "-q", "-m", "child work"], {
    cwd,
    env: {
      ...gitEnv(),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });

  assert.deepEqual(await removeWorktreeIfUnchanged(result.worktree), {
    removed: false,
  });
});

test("a worktree directory deleted from outside still gets its branch removed", async (t) => {
  const { dir, repo, agentDir } = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await createWorktree({ cwd: repo, name: "gone", agentDir });
  assert.ok(result.ok, result.ok ? "" : result.error);
  fs.rmSync(result.worktree.path, { recursive: true, force: true });

  assert.deepEqual(await removeWorktreeIfUnchanged(result.worktree), {
    removed: true,
  });
  const branches = execFileSync(
    "git",
    ["branch", "--list", result.worktree.branch],
    { cwd: repo, env: gitEnv() },
  ).toString();
  assert.equal(branches.trim(), "");
});

test("a deleted worktree directory keeps its branch when the branch has commits", async (t) => {
  const { dir, repo, agentDir } = makeRepo();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const result = await createWorktree({ cwd: repo, name: "kept", agentDir });
  assert.ok(result.ok, result.ok ? "" : result.error);
  const cwd = result.worktree.path;
  fs.writeFileSync(path.join(cwd, "d.txt"), "d\n");
  execFileSync("git", ["add", "d.txt"], { cwd, env: gitEnv() });
  execFileSync("git", ["commit", "-q", "-m", "child work"], {
    cwd,
    env: {
      ...gitEnv(),
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
  });
  fs.rmSync(cwd, { recursive: true, force: true });

  assert.deepEqual(await removeWorktreeIfUnchanged(result.worktree), {
    removed: false,
  });
  const branches = execFileSync(
    "git",
    ["branch", "--list", result.worktree.branch],
    { cwd: repo, env: gitEnv() },
  ).toString();
  assert.ok(branches.includes(result.worktree.branch), branches);
});
