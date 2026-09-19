import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  claudePermissionOptions,
  codexPermissionOptions,
  loadSubagentPermissions,
} from "./src/permissions.ts";

test("missing user configuration selects native auto review for both backends", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  try {
    const config = loadSubagentPermissions(directory);
    assert.deepEqual(config, { claude: "auto", codex: "auto" });
    assert.deepEqual(claudePermissionOptions(config.claude), {
      permissionMode: "auto",
      permissionPrompts: "none",
      allowDangerouslySkipPermissions: false,
    });
    assert.deepEqual(codexPermissionOptions(config.codex), {
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("user overrides are independent and permission bypass requires explicit configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  try {
    const file = join(directory, "subagents.json");
    await writeFile(file, JSON.stringify({ claude: "dontAsk" }));
    assert.deepEqual(loadSubagentPermissions(directory), {
      claude: "dontAsk",
      codex: "auto",
    });
    await writeFile(
      file,
      JSON.stringify({ claude: "bypassPermissions", codex: "full-access" }),
    );
    const config = loadSubagentPermissions(directory);
    assert.equal(
      claudePermissionOptions(config.claude).allowDangerouslySkipPermissions,
      true,
    );
    assert.deepEqual(codexPermissionOptions(config.codex), {
      sandbox: "danger-full-access",
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
    assert.deepEqual(codexPermissionOptions("sandbox"), {
      sandbox: "workspace-write",
      approvalPolicy: "never",
      approvalsReviewer: "user",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid or unreadable user configuration fails instead of silently changing permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-permissions-"));
  try {
    const file = join(directory, "subagents.json");
    for (const text of [
      "{",
      "null",
      "[]",
      '{"codex":"fullAccess"}',
      '{"claude":false}',
      '{"codxe":"sandbox"}',
    ]) {
      await writeFile(file, text);
      assert.throws(() => loadSubagentPermissions(directory), /subagents.json/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
