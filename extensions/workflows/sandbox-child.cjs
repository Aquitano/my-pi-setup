"use strict";

// The only objects shared with workflows are QuickJS values in WASM memory.
// Node permission mode provides a second boundary around this disposable worker.
const { newQuickJSWASMModuleFromVariant } = require(process.argv[2]);
const variant = require(process.argv[3]).default;
const sendIpc = process.send.bind(process);

const BOOTSTRAP = String.raw`
(function bootstrapWorkflowApi() {
  "use strict";
  const callHost = globalThis.__hostBridge;
  delete globalThis.__hostBridge;
  let nextRequestId = 0;
  const unconsumed = new Set();
  const inFlight = new Set();

  function deepFreeze(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 32 || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key], depth + 1);
    return value;
  }

  function requestAgent(promptValue, optionsValue = {}) {
    const id = ++nextRequestId;
    unconsumed.add(id);
    let started;
    const begin = () => {
      unconsumed.delete(id);
      if (!started) {
        let payload;
        try {
          payload = JSON.stringify({
            id,
            prompt: typeof promptValue === "string" ? promptValue : String(promptValue ?? ""),
            options: optionsValue && typeof optionsValue === "object" ? optionsValue : {},
          });
        } catch (error) {
          started = Promise.reject(new Error("agent() arguments must be serializable: " + error.message));
          return started;
        }
        inFlight.add(id);
        started = callHost("agent", payload)
          .then((json) => JSON.parse(json))
          .finally(() => inFlight.delete(id));
      }
      return started;
    };
    return Object.freeze({
      then(resolve, reject) {
        return begin().then(resolve, reject);
      },
      catch(reject) {
        return begin().catch(reject);
      },
      finally(callback) {
        return begin().finally(callback);
      },
      get [Symbol.toStringTag]() {
        return "Promise";
      },
    });
  }

  async function mapLimited(items, concurrency, invoke) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await invoke(items[index]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  async function parallel(items, options = {}) {
    if (!Array.isArray(items)) throw new Error("parallel() expects an array of zero-argument agent thunks");
    const requested = options && typeof options.concurrency === "number"
      ? Math.floor(options.concurrency)
      : 4;
    if (!Number.isFinite(requested) || requested < 1) {
      throw new Error("parallel(): concurrency must be a positive integer");
    }
    const concurrency = Math.min(4, requested);
    return mapLimited(items, concurrency, (item) => {
      if (typeof item !== "function") {
        throw new Error("parallel() items must be zero-argument functions");
      }
      return item();
    });
  }

  function phase(title) {
    callHost("phase", JSON.stringify({ title: String(title) }));
  }

  const argsEnvelope = JSON.parse(globalThis.__argsJson);
  const args = argsEnvelope.defined ? deepFreeze(argsEnvelope.value) : undefined;
  delete globalThis.__argsJson;
  const stringify = JSON.stringify;
  function serializeResult(value) {
    const seen = new WeakSet();
    return stringify(value === undefined ? null : value, (_key, item) => {
      if (typeof item === "bigint") return item.toString() + "n";
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[circular]";
        seen.add(item);
      }
      return item;
    });
  }
  Object.defineProperties(globalThis, {
    agent: { value: requestAgent, writable: false, configurable: false },
    parallel: { value: parallel, writable: false, configurable: false },
    phase: { value: phase, writable: false, configurable: false },
    args: { value: args, writable: false, configurable: false },
    __workflowCheck: {
      value: Object.freeze(() => ({
        unconsumed: unconsumed.size,
        inFlight: inFlight.size,
      })),
      writable: false,
      configurable: false,
    },
    __workflowSerialize: {
      value: Object.freeze(serializeResult),
      writable: false,
      configurable: false,
    },
  });
})();
`;

let initialized = false;
let token;
let context;
let runtime;
let workflowPromise;
let deadline = 0;
let finished = false;
const pendingAgents = new Map();

function send(message) {
  if (!finished) sendIpc({ token, ...message });
}

function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  send({ kind: "error", error: message.slice(0, 16 * 1024) });
  finished = true;
}

function guestError(handle) {
  if (Date.now() >= deadline) return new Error("Workflow execution timed out");
  const value = context.dump(handle);
  return new Error(value?.message ?? String(value));
}

function drain() {
  // One budget covers the entire microtask queue, including endless await loops.
  while (runtime.hasPendingJob()) {
    if (Date.now() >= deadline) throw new Error("Workflow execution timed out");
    const result = runtime.executePendingJobs(1);
    if (result.error) {
      const error = guestError(result.error);
      result.error.dispose();
      throw error;
    }
  }
  const state = context.getPromiseState(workflowPromise);
  if (state.type === "rejected") {
    const error = guestError(state.error);
    state.error.dispose();
    throw error;
  }
  if (state.type === "fulfilled") {
    const resultJson = context.getString(state.value);
    state.value.dispose();
    send({ kind: "result", resultJson });
    finished = true;
  }
}

process.on("message", (message) => {
  if (!message || typeof message !== "object" || finished) return;
  if (!initialized) {
    if (
      message.kind !== "init" ||
      typeof message.token !== "string" ||
      typeof message.source !== "string" ||
      typeof message.argsJson !== "string"
    )
      return;
    initialized = true;
    token = message.token;
    void run(message.source, message.argsJson).catch(fail);
    return;
  }
  if (message.token !== token || message.kind !== "agentResult") return;
  const pending = pendingAgents.get(message.id);
  if (!pending) return;
  pendingAgents.delete(message.id);
  try {
    deadline = Date.now() + 1000;
    const value =
      typeof message.resultJson === "string"
        ? context.newString(message.resultJson)
        : context.newError("Agent IPC failed");
    if (typeof message.resultJson === "string") pending.resolve(value);
    else pending.reject(value);
    value.dispose();
    pending.dispose();
    drain();
  } catch (error) {
    fail(error);
  }
});

async function run(source, argsJson) {
  const module = await newQuickJSWASMModuleFromVariant(variant);
  runtime = module.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  context = runtime.newContext();
  const args = context.newString(argsJson);
  context.setProp(context.global, "__argsJson", args);
  args.dispose();
  const bridge = context.newFunction("bridge", (kindHandle, payloadHandle) => {
    const kind = context.getString(kindHandle);
    const payloadJson = context.getString(payloadHandle);
    if (kind === "phase") {
      if (Buffer.byteLength(payloadJson) > 4096)
        throw new Error("Phase exceeds IPC limit");
      send({ kind, payloadJson });
      return context.undefined;
    }
    if (kind !== "agent") throw new Error("Unknown workflow operation");
    if (Buffer.byteLength(payloadJson) > 512 * 1024)
      throw new Error("Agent request exceeds IPC limit");
    if (pendingAgents.size >= 32)
      throw new Error("Too many pending agent requests");
    const id = JSON.parse(payloadJson).id;
    const pending = context.newPromise();
    pendingAgents.set(id, pending);
    send({ kind, payloadJson });
    return pending.handle.dup();
  });
  context.setProp(context.global, "__hostBridge", bridge);
  bridge.dispose();
  deadline = Date.now() + 1000;
  const evaluate = (code) => {
    const result = context.evalCode(code, "workflow.js");
    if (result.error) {
      const error = guestError(result.error);
      result.error.dispose();
      throw error;
    }
    return result.value;
  };
  evaluate(BOOTSTRAP).dispose();
  // Compile separately so wrapper syntax cannot bypass the completion checks.
  const body = `"use strict"; return (async function workflow() {\n${source}\n})();`;
  evaluate(
    `globalThis.__workflowBody = new Function("agent", "parallel", "phase", "args", ${JSON.stringify(body)});`,
  ).dispose();
  workflowPromise = evaluate(`
    (() => {
      const workflowBody = globalThis.__workflowBody;
      delete globalThis.__workflowBody;
      return Promise.resolve(workflowBody(agent, parallel, phase, args)).then(async value => {
        await Promise.resolve();
        const pending = __workflowCheck();
        if (pending.unconsumed > 0) throw new Error("Workflow created " + pending.unconsumed + " unawaited agent() call(s)");
        if (pending.inFlight > 0) throw new Error("Workflow returned before agent calls settled");
        return __workflowSerialize(value);
      });
    })()
  `);
  drain();
}
