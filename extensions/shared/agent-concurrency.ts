import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const DEFAULT_AGENT_LIMIT = 4;

export function parseAgentLimit(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 32
  ) {
    throw new Error("maxRunning must be an integer between 1 and 32");
  }
  return value;
}

export function loadAgentLimit(agentDir = getAgentDir()) {
  const file = join(agentDir, "concurrency.json");
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !("maxRunning" in value) ||
      Object.keys(value).some((key) => key !== "maxRunning")
    ) {
      throw new Error('Expected { "maxRunning": number }');
    }
    return parseAgentLimit(value.maxRunning);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return DEFAULT_AGENT_LIMIT;
    throw new Error(
      `Invalid ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** FIFO capacity shared by all agent producers in this Pi process. */
export class AgentConcurrency {
  private active = 0;
  private limit = DEFAULT_AGENT_LIMIT;
  private readonly queue: Array<{
    signal: AbortSignal;
    grant: (release: () => void) => void;
  }> = [];

  configure(limit: number) {
    this.limit = parseAgentLimit(limit);
    this.drain();
  }

  get snapshot() {
    return {
      active: this.active,
      waiting: this.queue.length,
      limit: this.limit,
    };
  }

  private reserve() {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  tryAcquire() {
    if (this.queue.length > 0 || this.active >= this.limit) return undefined;
    return this.reserve();
  }

  acquire(signal: AbortSignal) {
    if (signal.aborted)
      return Promise.reject(
        signal.reason ?? new Error("Agent request aborted"),
      );
    const release = this.tryAcquire();
    if (release) return Promise.resolve(release);
    return new Promise<() => void>((resolve, reject) => {
      const waiter = {
        signal,
        grant: (release: () => void) => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
      };
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        signal.removeEventListener("abort", onAbort);
        reject(signal.reason ?? new Error("Agent request aborted"));
        this.drain();
      };
      this.queue.push(waiter);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private drain() {
    while (this.active < this.limit && this.queue.length > 0) {
      const waiter = this.queue.shift()!;
      if (!waiter.signal.aborted) waiter.grant(this.reserve());
    }
  }
}

// Pi can load these modules through separate extension loaders. A process-global
// symbol prevents each loader from silently creating its own budget.
const key = Symbol.for("my-pi-setup.agent-concurrency.v1");
const state = globalThis as typeof globalThis & { [key]?: AgentConcurrency };
export function getAgentConcurrency() {
  const pool = (state[key] ??= new AgentConcurrency());
  pool.configure(loadAgentLimit());
  return pool;
}
