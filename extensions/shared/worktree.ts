import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const GIT_TIMEOUT_MS = 10_000;

/** Repository-location overrides from the parent shell must not redirect these commands away from `cwd`. */
export function gitEnv(base: NodeJS.ProcessEnv = process.env) {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, ...env } = base;
  void GIT_DIR;
  void GIT_WORK_TREE;
  void GIT_INDEX_FILE;
  return env;
}

export interface Worktree {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly repoRoot: string;
}

export type WorktreeResult =
  { ok: true; worktree: Worktree } | { ok: false; error: string };

export type WorktreeRemoval =
  { removed: true } | { removed: false; error?: string };

function git(args: string[], cwd: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        "git",
        args,
        {
          cwd,
          env: gitEnv(),
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          const code =
            error && "code" in error && typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0;
          resolve({
            code,
            stdout: String(stdout),
            stderr: error && !stderr ? error.message : String(stderr),
          });
        },
      );
    },
  );
}

export function worktreeSlug(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return `${base || "task"}-${randomBytes(2).toString("hex")}`;
}

export function worktreesDir(agentDir = getAgentDir()) {
  return path.join(agentDir, "worktrees");
}

/** Check out HEAD into a new worktree on a fresh branch under the agent directory. */
export async function createWorktree(options: {
  cwd: string;
  name: string;
  agentDir?: string;
}): Promise<WorktreeResult> {
  const root = await git(["rev-parse", "--show-toplevel"], options.cwd);
  if (root.code !== 0) {
    return {
      ok: false,
      error: `${options.cwd} is not inside a git repository`,
    };
  }
  const repoRoot = root.stdout.trim();
  const head = await git(["rev-parse", "HEAD"], repoRoot);
  if (head.code !== 0) {
    return {
      ok: false,
      error: "Repository has no commits yet; a worktree needs a base commit",
    };
  }
  const baseCommit = head.stdout.trim();
  const slug = worktreeSlug(options.name);
  const branch = `pi/${slug}`;
  const worktreePath = path.join(
    worktreesDir(options.agentDir),
    path.basename(repoRoot),
    slug,
  );
  try {
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: `Cannot create ${path.dirname(worktreePath)}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  await git(["worktree", "prune"], repoRoot);
  const added = await git(
    ["worktree", "add", "-b", branch, worktreePath, baseCommit],
    repoRoot,
  );
  if (added.code !== 0) {
    return {
      ok: false,
      error: added.stderr.trim() || "git worktree add failed",
    };
  }
  return {
    ok: true,
    worktree: {
      path: worktreePath,
      branch,
      baseCommit,
      repoRoot,
    },
  };
}

/**
 * True when the worktree has uncommitted edits or commits beyond its base.
 * Without the directory, the branch tip alone decides. A failing git call
 * counts as changed.
 */
export async function worktreeHasChanges(worktree: Worktree) {
  if (fs.existsSync(worktree.path)) {
    const status = await git(["status", "--porcelain"], worktree.path);
    if (status.code !== 0 || status.stdout.trim()) return true;
  }
  const tip = await git(
    ["rev-parse", "--verify", `refs/heads/${worktree.branch}`],
    worktree.repoRoot,
  );
  return tip.code !== 0 || tip.stdout.trim() !== worktree.baseCommit;
}

/** Remove the worktree and its branch when nothing was changed or committed. */
export async function removeWorktreeIfUnchanged(
  worktree: Worktree,
): Promise<WorktreeRemoval> {
  if (await worktreeHasChanges(worktree)) return { removed: false };
  if (fs.existsSync(worktree.path)) {
    const removal = await git(
      ["worktree", "remove", "--force", worktree.path],
      worktree.repoRoot,
    );
    if (removal.code !== 0) {
      return { removed: false, error: removal.stderr.trim() };
    }
  } else {
    await git(["worktree", "prune"], worktree.repoRoot);
  }
  const branch = await git(
    ["branch", "-D", worktree.branch],
    worktree.repoRoot,
  );
  if (branch.code !== 0) return { removed: false, error: branch.stderr.trim() };
  return { removed: true };
}
