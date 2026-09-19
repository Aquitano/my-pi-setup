# Proposal: resume workflows from named agent checkpoints

Status: design only. The `workflow` tool cannot resume a run today. The parameters and examples below are proposed, not implemented.

## Why a separate change

A workflow can finish several agents before a cancellation, a provider failure, or a Pi restart. Starting over repeats their work, and an agent that edits files or runs commands repeats its side effects.

The saved artifacts hold the script, arguments, run details, result, and transcripts. They do not record every exact agent result, and they cannot tell an agent that never started from one that changed files before its result was saved. Transcript previews are not checkpoints.

Resume should reuse completed results. When a previous call's outcome is unknown it must stop and wait for an explicit retry decision. It does not make agent tools exactly-once.

## Proposed first version

Resumption is opt-in with `resumable: true`. Every `agent()` call in such a run supplies a unique, stable `checkpoint` name. Ordinary workflows keep their current behavior.

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

A later tool call passes `resume: "wf_<id>"`. Pi loads the original script and arguments and rejects replacement script or args fields. The call creates a new attempt linked to the original run and keeps the earlier artifacts. Nothing resumes automatically at startup.

The script runs again from the beginning. At each checkpoint Pi returns the saved result or runs the agent. Phase updates and plain JavaScript repeat. The JavaScript heap, promises, running agent sessions, and individual agent tool calls are not restored.

The first version supports sequential agents and the existing bounded `parallel()` helper. Parallel calls use stable names derived from their input, such as `review:src/index.ts`, never their completion order. Duplicate names within an attempt are rejected before dispatch. Checkpoint names are journal data, never filenames.

## The checkpoint store

A host-owned `CheckpointStore` in `extensions/workflows/checkpoints.ts` handles run creation, resume validation, and execution of a named call. Callers never touch journal records directly.

The store records:

- A format version, run identity, original working directory, source hash, argument hash, and orchestration compatibility version.
- Each checkpoint's name and request signature: prompt, canonicalized options and schema, resolved provider, model and effort, and the relevant tool-policy configuration.
- The exact bounded result delivered across the sandbox bridge, including `ok: false` results. An oversized result fails explicitly. A checkpoint is never truncated and replayed as different data.
- A state of `started` or `completed`, the attempt identity, timestamps, and any explicit retry decision.

The store validates everything it reads. It rejects unsupported versions, invalid state transitions, missing results, signature mismatches, and files over its byte and record limits. The existing 32-call budget and IPC limits stay. A total journal limit of 20 MiB per run lineage is proposed for the first version.

Writes use private file modes, atomic replacement, and file and directory sync where supported. `started` is saved durably before dispatch and `completed` before the result reaches JavaScript. A persistence failure stops execution rather than falling back to uncached work.

The store takes an exclusive lock on the run lineage before reading or writing it, so two Pi processes cannot resume the same run. A stale lock is cleared only after verifying its owner is gone. Elapsed time alone is not enough. Run IDs and canonical paths are validated, and symlinks that escape the user-owned workflow directory are rejected.

## Resume decisions

| Stored state                            | Resume behavior                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| No record                               | Persist `started`, acquire shared agent capacity, and dispatch.                 |
| `completed`, matching signature         | Return the saved result without launching an agent or consuming a running slot. |
| `completed`, different signature        | Stop and identify the checkpoint mismatch.                                      |
| `started`, no durable result            | Stop and report an unknown outcome. Do not dispatch automatically.              |
| Invalid journal or incompatible version | Stop with an actionable error.                                                  |

A queued call can hold a `started` record although no provider request was sent. Treating it as unknown is conservative and keeps the first protocol small.

An unknown outcome shows the checkpoint prompt, attempt time, transcript location, and working directory. The user inspects the work and retries that checkpoint explicitly, accepting that edits or commands may repeat. The tool never infers consent from the original workflow request. A proposed `retry_checkpoints` field names the checkpoints authorized for retry. Failed `ok: false` results otherwise replay unchanged.

The first version has no "mark complete" with invented output. A person-supplied agent result needs its own validation and audit path.

## Integration points

1. Extend the workflow parameters in `index.ts` and the descriptions in `prompt.ts`. Resolve either a new script or a validated saved run before constructing the controller.
2. Pass `checkpoint` as another validated primitive option through `sandbox.ts`. The sandbox never sees journal paths, locks, or files. Implement this after the QuickJS isolation change.
3. Wrap the host `agentFn` with the store. A cache hit bypasses the runner and the shared concurrency queue. A new attempt uses the same runner, cancellation, trust checks, and capacity pool as any agent.
4. Record reused checkpoints separately in the run details so the dashboard can tell cached work from newly executed agents. Transcripts stay in their original attempt and are linked.
5. Add a resume action to `/workflows` only after the tool path is tested. Show unknown outcomes before offering a retry action.

Project trust and permissions are re-evaluated at resume time. A saved run is not a grant of old permissions. Resolved model choices are pinned in request signatures. A change that makes a checkpoint incompatible requires a new run or an explicit migration, never silent reuse.

Resume assumes deterministic orchestration for the same inputs and saved results. A changed prompt, model, schema, or other request input fails signature validation. Arbitrary use of clocks, randomness, or external state is not replayed deterministically. The model-facing workflow instructions document these limits.

## Verification before enabling resume

Use fake agents with side-effect counters and fault injection at journal boundaries:

- Crash after a completed result is saved: resume reuses it and the counter stays at one.
- Crash after dispatch but before completion is saved: resume stops without increasing the counter.
- Explicit retry of that checkpoint: exactly one more dispatch happens and the decision is recorded.
- Cancel while queued and while running: no implicit retry on restart.
- Resume from two processes at once: only one gets the lineage lock.
- Reorder parallel completion: results still match checkpoint identity and request signatures.
- Change source, args, cwd, schema, model, or permissions: incompatible reuse fails before launching an agent.
- Corrupt or truncate a journal, or fail a write: execution stops with no fabricated cache hit and no unjournaled dispatch.
- Restart Pi and load through a packed production install: completed results survive without live credentials.
- Load an old, non-resumable run: report that it has no checkpoints instead of claiming it can resume.

## Implementation sequence

First the bounded store, signatures, locking, and crash protocol, with tests. Then the opt-in tool and API integration with fake-runner end-to-end tests. Finally the dashboard actions and unknown-outcome review. Each stage stays disabled for ordinary runs until its integration checks pass.

This is feasible but larger than a replay flag. The sandbox, shared concurrency, and settings UI ship independently while this protocol is reviewed.
