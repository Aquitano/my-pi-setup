import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("summary settings persist in the agent directory rather than the package checkout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-summary-config-"));
  const original = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    const { PRIVATE_CONFIG_PATH, saveSummaryConfig, loadSummaryConfig } =
      await import("./src/config.ts");
    const config = {
      provider: "example",
      model: "summary-model",
      reasoning: "off",
    } as const;
    assert.equal(PRIVATE_CONFIG_PATH, join(directory, "summaries.json"));
    await saveSummaryConfig(config);
    assert.deepEqual(
      JSON.parse(await readFile(PRIVATE_CONFIG_PATH, "utf8")),
      config,
    );
    assert.deepEqual(loadSummaryConfig(), config);
  } finally {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = original;
    await rm(directory, { recursive: true, force: true });
  }
});
