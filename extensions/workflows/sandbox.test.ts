import assert from "node:assert/strict";
import { test } from "node:test";
import { runWorkflowSandbox } from "./sandbox.ts";

function run(
  source: string,
  overrides: Partial<Parameters<typeof runWorkflowSandbox>[0]> = {},
) {
  const abort = new AbortController();
  return runWorkflowSandbox({
    source,
    args: undefined,
    cwd: process.cwd(),
    signal: abort.signal,
    onAgent: async (prompt) => ({ ok: true, output: `reply:${prompt}` }),
    onPhase: () => {},
    ...overrides,
  });
}

test("sandbox exposes only workflow capabilities and validates results", async () => {
  const phases: string[] = [];
  const result = await run(
    `
      phase("Gather");
      const replies = await parallel([
        () => agent("one"),
        () => agent("two"),
      ], { concurrency: 99 });
      return {
        replies: replies.map((reply) => reply.output),
        processType: typeof process,
        requireType: typeof require,
        fetchType: typeof fetch,
      };
    `,
    { onPhase: (title) => phases.push(title) },
  );
  assert.deepEqual(result, {
    replies: ["reply:one", "reply:two"],
    processType: "undefined",
    requireType: "undefined",
    fetchType: "undefined",
  });
  assert.deepEqual(phases, ["Gather"]);
});

test("sandbox result serialization handles cycles and bigint", async () => {
  const result = await run(`
    const value = { count: 7n };
    value.self = value;
    return value;
  `);
  assert.deepEqual(result, { count: "7n", self: "[circular]" });
});

test("sandbox rejects unawaited agent calls", async () => {
  let calls = 0;
  await assert.rejects(
    run(`agent("orphan"); return "done";`, {
      onAgent: async () => {
        calls++;
        return { ok: true, output: "unexpected" };
      },
    }),
    /unawaited agent/,
  );
  assert.equal(calls, 0);
});

test("sandbox source cannot escape the host accounting wrapper", async () => {
  let calls = 0;
  await assert.rejects(
    run(
      `}), agent("orphan"), Promise.resolve("bypass"); (async function () {`,
      {
        onAgent: async () => {
          calls++;
          return { ok: true, output: "unexpected" };
        },
      },
    ),
    /unawaited agent/,
  );
  assert.equal(calls, 0);
});

test("sandbox VM still rejects non-yielding synchronous code", async () => {
  await assert.rejects(run(`while (true) {}`), /timed out/);
});

test("agent promises and errors never expose the Node host realm", async () => {
  const result = await run(`
    const promise = agent("probe").then(value => value);
    let escaped = false;
    try { escaped = !!promise.constructor.constructor("return process")(); } catch {}
    const reply = await promise;
    let errorEscaped = false;
    try { null.missing(); } catch (error) {
      try { errorEscaped = !!error.constructor.constructor("return process")(); } catch {}
    }
    return { escaped, errorEscaped, output: reply.output };
  `);
  assert.deepEqual(result, {
    escaped: false,
    errorEscaped: false,
    output: "reply:probe",
  });
});

test("CPU limits also apply after awaiting an agent and inside microtasks", async () => {
  for (const source of [
    `await agent("start"); while (true) {}`,
    `await Promise.resolve(); while (true) { await Promise.resolve(); }`,
  ]) {
    await assert.rejects(
      run(source, { signal: AbortSignal.timeout(5_000) }),
      /timed out/,
    );
  }
});

test("workflow dynamic imports cannot access Node modules", async () => {
  await assert.rejects(
    run(`return await import("node:fs");`),
    /module|import/i,
  );
});

test("workflow agent invocations have no per-request wall timer", async () => {
  let signalAborted = false;
  const result = await run(`return (await agent("delayed")).output;`, {
    onAgent: async (_prompt, _options, signal) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      signalAborted = signal.aborted;
      return { ok: true, output: "completed" };
    },
  });

  assert.equal(result, "completed");
  assert.equal(signalAborted, false);
});

test("workflow cancellation aborts a pending agent request", async () => {
  const controller = new AbortController();
  let startedResolve: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  let requestAborted = false;
  const pending = run(`return await agent("pending");`, {
    signal: controller.signal,
    onAgent: async (_prompt, _options, signal) => {
      startedResolve?.();
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            requestAborted = true;
            resolve();
          },
          { once: true },
        );
      });
      return { ok: false, output: "", error: "Agent was aborted" };
    },
  });

  await started;
  controller.abort(new Error("cancel fixture"));
  await assert.rejects(pending, /Workflow was aborted/);
  assert.equal(requestAborted, true);
});

test("oversized phase updates and results fail the run", async () => {
  await assert.rejects(run('phase("x".repeat(5000));'), /invalid phase update/);
  await assert.rejects(run('return "x".repeat(2 * 1024 * 1024);'), /IPC limit/);
});

test("phase updates cannot flood the host IPC queue", async () => {
  await assert.rejects(
    run('for (let i = 0; i < 1000; i++) phase("step");'),
    /phase update budget/,
  );
});

test("guest memory is bounded and the run fails fast", async () => {
  // Slow runners hit the one-second slice before the 128 MiB cap; either way
  // the run must end quickly instead of growing to the 2 GiB WASM maximum.
  const started = Date.now();
  await assert.rejects(
    run('const a = []; for (;;) a.push("x".repeat(8 << 20));'),
    /out of memory|timed out/,
  );
  assert.ok(Date.now() - started < 5_000);
});

test("stalled and hijacked workflows fail instead of hanging", async () => {
  await assert.rejects(run("await new Promise(() => {});"), /can never settle/);
  await assert.rejects(
    run(`
      Promise.prototype.finally = function (callback) { callback(); return this; };
      agent("x").then(() => {});
      return "done-early";
    `),
  );
});

test("throwing a promise reports a guest error", async () => {
  await assert.rejects(
    run("throw Promise.reject(new Error('inner'));"),
    (error: Error) => {
      assert.doesNotMatch(error.message, /not alive/);
      return true;
    },
  );
});
