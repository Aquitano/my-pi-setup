import { mkdtempSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const live = process.argv.includes("--live");
const liveTests = new Set(["claude.test.ts", "codex.test.ts"]);
const tests = readdirSync("extensions", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    readdirSync(`extensions/${entry.name}`)
      .filter(
        (name) => name.endsWith(".test.ts") && liveTests.has(name) === live,
      )
      .map((name) => `extensions/${entry.name}/${name}`),
  );
const result = spawnSync(
  process.execPath,
  ["--test", "--experimental-strip-types", ...tests],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-test-agent-")),
    },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
