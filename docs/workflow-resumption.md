# Proposal: resume workflows from named agent checkpoints

Status: design only. The current `workflow` tool cannot resume a run. The parameters and examples below are proposed APIs, not available commands.

## Why this needs a separate change

A workflow can finish several agents before cancellation, a provider failure, or a Pi restart. Starting over repeats their work. Some agents edit files or run commands, so repeating an interrupted call can also repeat side effects.

The existing artifacts retain the script, arguments, run details, result, and transcripts. They do not provide a durable record of every exact agent result or distinguish an agent that never started from one that changed files before its result was saved. Transcript previews cannot serve as checkpoints.

Resume should reuse known completed results. It must stop when a previous call's outcome is unknown and require a deliberate decision before retrying it. This does not provide exactly-once execution of agent tools.

## Proposed first version

Make resumption opt-in with `resumable: true`. Every `agent()` call in that run must supply a unique, stable `checkpoint` name. Ordinary workflows retain their current behavior.

```javascript
// Proposed script for a workflow started with resumable: true.
const review = await agent(`Review ${args.file}`, {
  checkpoint: "review",
  schema: REVIEW_SCHEMA,
});
if (!review.ok) return review;

return await agent(`Apply these fixes: ${JSON.stringify(review.structured)}`, {
  checkpoint: "apply-fixes",
});
```

A later tool invocation supplies `resume: "wf_<id>"`. Pi loads the original script and arguments; it rejects replacement script/args fields. The invocation creates a new attempt linked to the original run, preserving earlier artifacts. No startup hook automatically resumes work.

The script starts again from the beginning. At each checkpoint, Pi either returns the saved result or executes the next agent. Phase updates and pure JavaScript calculations can repeat. The JavaScript heap, promises, running agent sessions, and individual agent tool calls are not restored.

The first version should support sequential agents and the existing bounded `parallel()` helper. Parallel calls use stable names derived from input identity, such as `review:src/index.ts`, rather than their completion order. Reject duplicate names within an attempt before dispatch. Checkpoint names are data in a journal, never filenames.

## The checkpoint store

Introduce a host-owned `CheckpointStore` in `extensions/workflows/checkpoints.ts`. Its interface handles run creation, resume validation, and execution of a named call. Callers should not manipulate journal records directly.

The store records:

- A format version, run identity, original working directory, source hash, argument hash, and orchestration compatibility version.
- Each checkpoint's name and request signature: prompt, canonicalized options/schema, resolved provider/model/effort, and relevant tool-policy configuration.
- The exact bounded result delivered across the sandbox bridge, including `ok: false` results. Oversized results must fail explicitly; never silently truncate a checkpoint and later replay different data.
- A state of `started` or `completed`, attempt identity, timestamps, and any explicit retry decision.

Validate all persisted data at the storage boundary. Reject unsupported versions, invalid state transitions, missing results, signature mismatches, and files exceeding the store's byte/record limits. Keep the existing 32-call budget and IPC limits; add a total journal limit, proposed as 20 MiB per run lineage for the first version.

Use private directory/file modes, atomic replacement, and file/directory synchronization where supported. Save `started` durably before dispatch. Save `completed` durably before returning its result to JavaScript. Persistence failures stop execution instead of falling back to uncached work.

Acquire an exclusive lock for the run lineage before inspecting or updating it. Two Pi processes must not resume it concurrently. A stale lock must be resolved explicitly after verifying that its owner is gone; time elapsed alone is insufficient. Validate run IDs and canonical paths, and reject symlinks that escape the user-owned workflow directory.

## Resume decisions

| Stored state                            | Resume behavior                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| No record                               | Persist `started`, acquire shared agent capacity, and dispatch.                 |
| `completed`, matching signature         | Return the saved result without launching an agent or consuming a running slot. |
| `completed`, different signature        | Stop and identify the checkpoint mismatch.                                      |
| `started`, no durable result            | Stop and report an unknown outcome. Do not dispatch automatically.              |
| Invalid journal or incompatible version | Stop with an actionable error.                                                  |

A queued call might have a `started` record even if no provider request was sent. Treating that case as unknown is conservative and keeps the first protocol small.

An unknown outcome should show the checkpoint prompt, attempt time, transcript location, and working directory. The user can inspect the work and explicitly retry that checkpoint, accepting that edits or commands may repeat. The tool must not infer consent from the original workflow request. A proposed `retry_checkpoints` field names the exact checkpoints authorized for retry; failed `ok: false` results otherwise replay unchanged.

Do not offer “mark complete” with invented output in the first version. An agent result supplied by a person would need its own validation and audit path.

## Integration points

1. Extend workflow parameters in `index.ts` and the descriptions in `prompt.ts`. Resolve either a new script or a validated saved run before constructing the controller.
2. Pass `checkpoint` as another validated primitive option through `sandbox.ts`. The sandbox never receives journal paths, locks, or file access. Prefer implementing this after the QuickJS isolation change.
3. Wrap the host `agentFn` with the store. A cache hit bypasses the runner and shared concurrency queue; a new attempt uses the same runner, cancellation, trust checks, and capacity pool as ordinary agents.
4. Record reused checkpoints separately in run details so the dashboard can distinguish cached work from newly executed agents. Keep transcripts in their original attempt and link to them.
5. Add a resume action to `/workflows` only after the tool path is tested. Show unknown outcomes before presenting a retry action.

Re-evaluate current project trust and permissions at resume time. A saved run is not a grant of old permissions. Pin resolved model choices in request signatures; changes that make a checkpoint incompatible require a new run or an explicit migration, not silent reuse.

Resume assumes deterministic orchestration for the same inputs and saved results. Changed prompt construction, model selection, schema, or other request inputs must fail signature validation. Do not promise deterministic replay of arbitrary uses of clocks, randomness, or external state. Document those restrictions in the model-facing workflow instructions.

## Verification before enabling resume

Use fake agents with observable side-effect counters and fault injection at journal boundaries:

- Crash after a completed result is saved: resume reuses it and the counter remains one.
- Crash after dispatch but before completion is saved: resume stops without increasing the counter.
- Explicit retry of that checkpoint: exactly one additional dispatch occurs and the decision is recorded.
- Cancel while queued and while running: no implicit retry occurs on restart.
- Resume two processes concurrently: only one obtains the lineage lock.
- Reorder parallel completion: results still match checkpoint identity and request signatures.
- Change source, args, cwd, schema, model, or permissions: incompatible reuse fails before launching an agent.
- Corrupt/truncate a journal or fail a write: execution stops; no fabricated cache hit or unjournaled dispatch occurs.
- Restart Pi and load through a packed production install: completed results survive and no live credentials are needed for the test.
- Load an old, non-resumable run: report that it has no checkpoints rather than claiming it can resume.

## Suggested implementation sequence

First implement and test the bounded store, signatures, locking, and crash protocol. Then add the opt-in tool/API integration with fake-runner end-to-end tests. Finally add dashboard actions and unknown-outcome review. Keep each stage disabled for ordinary runs until the corresponding integration checks pass.

This is feasible, but it is larger than a small replay flag. The sandbox, shared concurrency, and settings UI can ship independently while this protocol is reviewed.
