import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

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
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
