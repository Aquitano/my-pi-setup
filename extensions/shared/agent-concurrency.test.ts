import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConcurrency, loadAgentLimit } from "./agent-concurrency.ts";

test("shared capacity queues fairly, cancels waiters, and releases only once", async () => {
  const pool = new AgentConcurrency();
  pool.configure(1);
  const first = pool.tryAcquire()!;
  const cancel = new AbortController();
  const cancelled = pool.acquire(cancel.signal);
  const next = pool.acquire(new AbortController().signal);
  assert.equal(pool.tryAcquire(), undefined);
  cancel.abort(new Error("cancelled"));
  await assert.rejects(cancelled, /cancelled/);
  first();
  first();
  const release = await next;
  assert.deepEqual(pool.snapshot, { active: 1, waiting: 0, limit: 1 });
  release();
  assert.equal(pool.snapshot.active, 0);
});

test("lowering capacity drains existing work before starting more", async () => {
  const pool = new AgentConcurrency();
  pool.configure(2);
  const first = pool.tryAcquire()!;
  const second = pool.tryAcquire()!;
  pool.configure(1);
  let started = false;
  const queued = pool.acquire(new AbortController().signal).then((release) => {
    started = true;
    return release;
  });
  first();
  await Promise.resolve();
  assert.equal(started, false);
  second();
  (await queued)();
  assert.equal(pool.snapshot.active, 0);
});

test("user limit defaults safely and rejects malformed configuration", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-concurrency-"));
  try {
    assert.equal(loadAgentLimit(dir), 4);
    for (const value of [0, 33, 1.5, "4", null]) {
      writeFileSync(
        join(dir, "concurrency.json"),
        JSON.stringify({ maxRunning: value }),
      );
      assert.throws(() => loadAgentLimit(dir), /maxRunning/);
    }
    writeFileSync(join(dir, "concurrency.json"), '{"maxRunning":2}');
    assert.equal(loadAgentLimit(dir), 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
