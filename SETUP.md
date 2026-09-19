# Set up the Pi package

Use Pi 0.82 or newer with Node.js 24.16 or newer.

## Install from GitHub

```sh
pi install git:github.com/Aquitano/my-pi-setup
```

For your own fork, replace `Aquitano` with your GitHub username. Pi installs the package dependencies and registers the extensions, skills, and theme. Run `/reload` in an open Pi session.

To install for one project, add `-l`:

```sh
pi install -l git:github.com/Aquitano/my-pi-setup
```

To update installed packages:

```sh
pi update --extensions
```

Use `pi config` to enable or disable individual extensions, skills, and themes.

## Migrate an existing directory installation

If this repository is already your `~/.pi/agent` directory, keep that checkout until you have backed up your settings and private files. Installing the package alongside its existing extensions would load duplicate tools.

1. Copy the repository to a separate development directory, excluding `node_modules`.
2. If `~/.pi/agent/extensions/summaries/config.private.json` exists, copy it to `~/.pi/agent/summaries.json` unless that file already exists.
3. Move this repository's extension directories, its two skill directories, and `themes/github-dark-default.json` out of `~/.pi/agent` into your backup. Keep unrelated extensions and skills.
4. Run the GitHub install command above and restart Pi.

Keep `auth.json`, `settings.json`, `trust.json`, model configuration, `.env`, sessions, and workflow history in your agent directory. Package updates do not replace those files.

## Select the theme

Set `theme` in `~/.pi/agent/settings.json`, keeping your other settings:

```json
{
  "theme": "github-dark-default"
}
```

## Enable Firecrawl

The search, scrape, and crawl tools require a Firecrawl API key. Create one using [Firecrawl's getting-started guide](https://docs.firecrawl.dev/quickstarts/nodejs), then set `FIRECRAWL_API_KEY` in your shell or add this line to `~/.pi/agent/.env`:

```dotenv
FIRECRAWL_API_KEY=fc-YOUR-API-KEY
```

If you do not use Firecrawl, disable `firecrawl-search` with `pi config`.

## Configure subagent permissions

Claude and Codex use automatic permission review by default. Install and authenticate the corresponding CLI before launching its subagents. Keep both CLIs current. Claude's headless permission handling requires Claude Code 2.1.259 or newer, and auto mode also depends on model and account availability.

To override the defaults, create `~/.pi/agent/subagents.json`:

```json
{
  "claude": "auto",
  "codex": "auto"
}
```

Each new subagent reads this file. Existing subagents keep their starting permissions. Omitted fields default to `auto`. Invalid settings stop the subagent from starting and report the configuration error.

| Backend | Setting | Behavior |
| --- | --- | --- |
| Claude | `auto` | Claude's permission classifier approves or denies actions. |
| Claude | `acceptEdits` | Approves file edits. Other actions follow Claude's permission rules. |
| Claude | `dontAsk` | Denies actions that would require a permission prompt. |
| Claude | `plan` | Uses Claude's planning mode. |
| Claude | `bypassPermissions` | Explicitly enables the previous permission-bypass behavior. |
| Codex | `auto` | Uses `workspace-write`, `on-request`, and the `auto_review` approval reviewer. |
| Codex | `sandbox` | Uses `workspace-write` and never requests escalation. |
| Codex | `full-access` | Explicitly disables sandboxing and approval prompts. |

These are headless sessions. Requests that still require a human are denied. Auto mode never falls back to unrestricted access. If Codex cannot confirm automatic review, update it or select `sandbox`.

The Pi backend continues to use Pi's own tools and trust settings. These overrides affect only Claude and Codex.

See [Claude permission modes](https://code.claude.com/docs/en/agent-sdk/permissions) and [Codex App Server](https://developers.openai.com/codex/app-server) for the native behavior.

## Isolate subagents in worktrees

Pass `isolation: "worktree"` to `subagent_spawn`, or `{ isolation: "worktree" }` to a workflow `agent()` call, and the child runs in a fresh git worktree on a branch named `pi/<name>-<id>`. Worktrees live under `~/.pi/agent/worktrees/<repo>/`. The worktree is checked out from the last commit, so uncommitted changes and ignored files such as `node_modules` or `.env` are not present in it. A worktree that ends without edits or commits is removed together with its branch when the subagent is disposed or the workflow agent finishes. A worktree with changes is kept, and the result message names its path and branch so the parent can diff or merge it.

## Deferred tools

The `deferred-tools` extension deactivates the Firecrawl tools, the background terminal tools, and the `workflow` tool at session start, so their descriptions stay out of the system prompt. The model calls `load_tools` with one or more groups (`web`, `terminals`, `workflows`) to activate them for the rest of the session. Groups stay loaded across `/reload`, `/resume`, and `/fork` because the extension re-reads the `load_tools` calls from the transcript. Headless children (subagents and workflow agents) keep every tool active. Edit `extensions/deferred-tools/catalog.ts` to change the groups. Disable the extension with `pi config` to keep every tool active.

## Shared agent concurrency

Workflow agents and Pi, Claude, and Codex subagents share one running-agent budget per Pi process. The default is four. Set `maxRunning` (1 to 32) in `~/.pi/agent/concurrency.json` (or under `PI_CODING_AGENT_DIR`):

```json
{ "maxRunning": 4 }
```

Workflow agents wait in arrival order when the budget is full, and cancelled calls leave the queue. Subagent spawns and idle restarts fail with a capacity error instead of waiting. Each workflow run also keeps its own fan-out limit of four. Edits to the file apply on the next admission, and lowering the limit lets running agents finish.

## Keep private state outside the package

Summary model preferences are saved to `~/.pi/agent/summaries.json`. Use `/summary-model` to change them. The old extension-local `config.private.json` remains a read fallback for existing directory installations.

The file-search extension uses installed `fd` or `fdfind` and `rg` first. If necessary, it downloads checksum-verified macOS or Linux binaries into `~/.pi/agent/bin`. Unsupported platforms require a manual binary installation.

All agent-directory paths above follow `PI_CODING_AGENT_DIR` when it is set. Do not put private configuration inside Pi's downloaded package checkout, because package updates can replace that checkout.

## Develop and verify a checkout

Install dependencies once at the repository root:

```sh
npm ci
npm run check
npm run format:check
npm run lint
npm test
npm run test:install
```

There are no per-extension installs or compiler-patching install hooks. The root lockfile pins dependencies, including the matching Effect v4 release-candidate packages. Use `npm ci` for reproducible development installs.

`npm test` runs offline tests. `npm run test:install` uses temporary directories to check production-only installation, repeat installation, packed resources, and Pi extension loading. It downloads dependencies as needed and does not change your Pi settings or call models.

To load a development checkout in Pi:

```sh
pi install /absolute/path/to/my-pi-setup
```

Live Claude and Codex tests are separate and use your authenticated accounts:

```sh
npm run test:live
```

## Resolve npm release-age errors

If npm reports that a recent version does not exist before an old date, inspect the `min-release-age` setting in your `.npmrc`. npm 11.13 interprets this value in **days**. For example, `1440` means almost four years, not one day.

If you intended a one-day delay, correct your user setting:

```sh
npm config set min-release-age 1 --location=user
```

To deliberately install a requested release newer than that delay, override the filter for one command:

```sh
npm install --min-release-age=0
```

For the isolated install check, pass the override to its nested npm commands:

```sh
npm run test:install -- --min-release-age=0
```

The package does not change your global npm settings. A release-age policy, unavailable registry, or unsupported Node version can still prevent installation.

### Workflow isolation

Workflow scripts run in a QuickJS interpreter compiled to WebAssembly, inside a separate Node process with restricted filesystem permissions. Only JSON crosses the `agent()` and `phase()` bridge. The interpreter ships with the package.

Each uninterrupted execution slice, including promise callbacks, may run for one second. Waiting for an agent does not count. The interpreter's WebAssembly memory is capped at 128 MiB. Source, arguments, results, agent requests (32 per run) and phase updates (256 per run) are bounded. Cancellation terminates the worker and aborts its outstanding agent requests.
