# NF-Stack

A personal task and coordination layer over T3 Code. T3 owns execution (threads, resume,
worktrees, scheduling, model catalog); NF owns tasks, acceptance, dependencies and attempts
(task → attempt → T3 thread).

- `skills/nf-meta`, `skills/nf-worker`, `skills/nf-review`, `skills/nf-direct`, `skills/nf-autoconfigure`:
  the coordination, direct-work and policy-setup skills.
- `packages/contracts` (`@nf/contracts`): Effect Schemas for tasks, attempts, usage and board views.
- `packages/core` (`@nf/core`): Effect services over the SQLite store, migrations, import, usage
  sync/stats, backup, skills linking.
- `packages/cli` (`@nf/cli`): the `nf` command. Skills call `nf` instead of hand-editing
  `.nf/tasks.json`; without `nf` on PATH they fall back to that file.
- `packages/board` (`@nf/board`): the Eskais UI Agent Task Board and the prebuilt page `nf board`
  fills with a snapshot.
- `packages/nf` (`@p-otero/nf-stack`): the published package: the CLI and `@nf/*` as one Node
  bundle, the prebuilt board and the `nf-*` skills, installed with `npm i -g`.
- `.agents/skills`: the installed board UI skills `eskais-ui`, `eskais-perf`, `eskais-mockup` and
  `ui-sdk`; [`AGENTS.md`](AGENTS.md) holds the commands that refresh them after a re-pin.

## Install

Requires Node 24.13+; `git` is required and `gh` optional, for pull request state on the board.

```sh
npm i -g @p-otero/nf-stack
nf setup
```

`nf setup` links the `nf-*` skills the package ships into `~/.agents/skills` and
`~/.claude/skills`, then proves it: `nf --version`, `nf status`, `nf policy status`, and `nf serve`'s
`/api/health` on a free port that it stops again. Each step prints what it did, and running it again
changes nothing. `nf skills link --dry-run` shows what the links would change; a target that is a
real folder is skipped unless `--force`. The package carries the CLI as one JavaScript bundle and
the prebuilt board page, so the install builds nothing.

### From a checkout

Contributors run nf from the TypeScript sources, which needs Bun 1.4+ as well:

```sh
git clone https://github.com/p-otero/nf-stack.git
cd nf-stack
bun run setup
```

`bun run setup` checks those prerequisites, runs `bun install`, builds the board bundle, links the
`nf` bin, and then runs `nf setup`, so a checkout goes through the same skills, store and
live-board checks as an npm install. A missing `nf` on the `PATH` is reported with the `~/.bun/bin`
advice.

Update an existing checkout with the same command:

```sh
git pull
bun run setup
```

The setup output says when this checkout is not registered with the store yet. Two one-time steps
follow per project checkout:

```sh
nf init                       # register this Git repo (worktrees resolve to the primary checkout)
nf t3 init                    # add the Board script (nf serve and its preview URL) to t3.json
```

Then import that script in T3 Code: project Actions settings -> **Import scripts** -> **Import from
t3.json**. The [Board](#board) section covers the snapshot and the live board.

The routing policy in `~/.nf/policy.yaml` is this machine's: run `/nf-autoconfigure` in T3 Code,
which proposes the policy from the model catalog T3 offers and writes it only after you approve the
diff. The setup output repeats that hint while the policy is missing or its catalog is stale.

## Task keys

Every project has a key prefix, unique in the store, derived from its name: a two-letter first
word is already an abbreviation and becomes the prefix (`nf-stack` -> `NF`), otherwise the first
two letters of the first word plus the first letter of the following words (`oxlint-rules` ->
`OXR`, `demo` -> `DE`). A collision extends the prefix with the name's following letters
(`NFS`), then a number. `nf init --prefix XYZ` sets it when registering and
`nf project set --prefix XYZ` changes it for the current project; the change re-keys the
project's tasks and attempts without changing their numbers, and a duplicate is rejected.

Task keys are `<PREFIX>-<number>` (`NF-018`) and attempt keys add `-A<attempt>` (`NF-018-A1`).
Every command that takes a key also accepts the legacy form (`T-018`, `T-018-A1`), and migration
v6 assigns prefixes to existing projects and re-keys their tasks. Recorded event notes keep the
keys they were written with: the audit trail is append-only.

## Store

`$NF_HOME/nf.db` (default `~/.nf`), SQLite in WAL mode through Effect SQL
(`@effect/sql-sqlite-node`, backed by `node:sqlite`). Commands print compact text;
add `--json` for machine output. A rejected operation exits non-zero with a one-line error.

Every command opens the store at its latest schema, so the first `nf` after an update migrates
the database. Before it applies pending migrations, nf copies the store with `VACUUM INTO` to
`$NF_HOME/backups/nf-pre-v<current schema>-<UTC timestamp>.db` and names that file on stderr, so
it can be restored if the migration goes wrong. When that copy cannot be written, nf aborts and
the store stays at its old schema. A fresh store (no `nf.db` yet) needs no copy.

`nf backup` writes a consistent snapshot to `$NF_HOME/backups/nf-<UTC timestamp>.db`. Both kinds
of backup are pruned to the newest 10 files; `NF_BACKUP_KEEP=n` keeps another number (a value
that is not a positive integer keeps 10). A backup is restored by copying it to `$NF_HOME/nf.db`
while no `nf` command runs.

The store records its schema version in SQLite's `user_version`. A store migrated by a newer nf
is refused before it is opened: nf prints the store's version, its own latest version and the
commands that update it (`git pull && bun install` in the nf checkout), and touches nothing.

## Usage

`nf sync` reads token usage read-only from T3 Code and Pi and attributes it to attempts. It also
records every subagent T3 spawned (app-owned and provider-native) and attributes it to the attempt
that launched it:

```sh
nf sync                       # both sources; --source t3|pi, --dry-run, --json
nf stats                      # per task, with tokens and API-equivalent cost
nf stats --by attempt|model|profile|month|strategy|context|coordinator
nf stats --by coordinator --profile-breakdown  # sub-rows per task profile
nf stats --all-projects       # include coordination and unattributed usage
nf stats task NF-001          # per-attempt breakdown, subagents and cost to acceptance
```

The coordinator records how it runs a task with `--strategy direct|plan|cheap|review|auto`
(`nf task add|set`, `nf attempt start`, where an attempt inherits the task's). Migration v4 adds
the nullable column, so older tasks stay unknown; v5 adds subagent spawn tracking and accepts
`--mechanism direct` for work a thread does itself. `nf stats --by strategy` compares strategies
by task count, spawns, cost to acceptance (quality-aware) and first-pass rate; the coordinator
thread's own usage and the spawns it made form their own `coordination` row, which is no task and
never counts in a first-pass rate. `nf stats --by context` reports the same metrics per context
transfer (`fresh`, `fork`, `reuse`, `compact`): a task that changed context counts in each, while
the per-context acceptance costs still add up to the task-level cost. `nf stats --by
model` adds spawns per model. `nf stats --by coordinator` compares coordinating models: tasks,
accepted tasks, first-pass rate, repairs, human interventions, each model's own turns priced per
turn (a thread that switched models counts for each), the workers' cost to acceptance and the
total cost per accepted task, with `--profile-breakdown` adding a sub-row per task profile.
`nf coordinator register --thread <id>` adds a coordinator thread beyond the project's recorded
one and, like `nf sync` once the coordinator's turns are ingested, re-derives the attempts it left
without a coordinator. `nf attempt start` records the coordinator thread plus the model of its
closest turn at or before the start; because usage is written when a turn completes, an attempt
dispatched by the coordinator starts before that turn is recorded, so with no turn at or before the
start the first turn after it answers. `--coordinator-model` overrides both. Human output notes
`n < 10: indicative`.
`nf stats task` lists an
attempt's subagents by kind and model, with the usage of its app-owned child threads as a
sub-bucket; a child thread that is itself an NF attempt keeps its own usage.

Sources are `~/.t3/userdata/statev2.sqlite` (`NF_T3_STATE`), `~/.pi/agent/sessions`
(`NF_PI_SESSIONS`) and prices. Only numbers, IDs, model/provider names and timestamps are stored;
prompts and tool output are never read into the store. Cost is `estimated` from the price chain
(`~$` in human output) or `reported` by Pi; an unknown price stays NULL and prints as `—`.
Re-syncing is idempotent, and forked Pi sessions are counted once (`responseId`-based dedupe).

### Prices

Every price nf uses — `nf stats` costs, the policy's caps, `nf policy propose` and `resolve` —
comes from the same chain, first match wins, and each answer carries the layer it came from
(`litellm`, `openrouter` or `manual`):

1. T3's cached LiteLLM rates, `~/.t3/userdata/usage-model-rates.json` (`NF_PRICES`).
2. OpenRouter's public catalog, `GET https://openrouter.ai/api/v1/models` (no auth, nothing about
   this machine in the request). `pricing.prompt` and `pricing.completion` are USD per token; a
   model's `openrouter` id in `model-traits.yaml` maps an NF model to it, and `:batch` variants are
   never used. The catalog is cached in `$NF_HOME/openrouter-models.json`, refreshed by `nf sync`
   and on demand when it is missing or older than 7 days. `NF_OFFLINE` set to any value keeps nf on
   the cache and skips the network; without a cache the model simply stays unpriced.
3. Manual overrides in `$NF_HOME/policy.yaml`:

```yaml
prices:
  "opencode-go/glm-5.3-flash": { input_per_m: 0.04, output_per_m: 0.08 }
```

A price prints as `$0.14/$0.42 per M (openrouter)` in proposals and resolutions; `nf sync` prints
the layers it refreshed, and `nf stats` notes the layers its stored costs were estimated from.

Both sources are normalized to one convention: `input_tokens` is uncached input only, cache reads
and writes are separate, and `output_tokens` already includes reasoning (`reasoning_tokens` is a
reporting subset, never priced on top). T3 reports input including its cache components, so
`nf sync` subtracts them and marks a turn `partial` if the result would be negative; it also skips
T3 local-command turns, whose counters are not model work. T3 `otherUsage` has no cache split, so
its reported input total is stored as-is with no cost (`unknown`); stats show those aggregate tokens
in the `AGG-*` columns, outside the priced totals and counted in the unknown-price events. Pi
already reports this shape.

## UI review

A task flagged `ui` (`nf task add --ui`, `nf task set --ui|--no-ui`) changes a screen, so it waits
for review with evidence. The flag shows as `[ui]` in task lists, as `ui: yes` in
`nf task show`, in `--json`, and as a `UI` label on the board card. A worker attaches a screenshot
of every screen, state and component it changed (each dialog, tab, empty and error state), once
per project theme, so the user can review all of it. Evidence is attached to the attempt that
produced it:

```sh
nf attempt attach NF-019-A1 --file light.png --kind screenshot --theme light --name checkout
nf attempt attach NF-019-A1 --file dark.png  --kind screenshot --theme dark  --name checkout
nf attempt attach NF-019-A1 --file flow.webm --kind recording --name checkout-flow
nf attempt show NF-019-A1 --attachments
```

`nf attempt attach` copies the file into `$NF_HOME/artifacts/<project>/<task>/<attempt>/` under a
content-hashed name (an existing file is never overwritten), records the row and an event, refuses
more than 15 MB, and refuses a non-image `screenshot` or non-video `recording`. A `screenshot`
needs a `--theme` that the project declares, and captures of the same `--name` pair up across
themes. The themes default to `light` and `dark`; `ui.themes` in the project config replaces them,
so a project that only ships a light theme asks for one screenshot. `nf attempt start` on a `ui`
task prints the attach commands to stderr (stdout stays the `<attempt key>  <client request id>`
line). `nf task accept` on a `ui` task fails until its accepted (newest writing) attempt has at
least one screenshot per configured theme, and until the user approves it when the change is
large; the error names what is missing. Tasks without the flag accept as before.

`nf task reject NF-019 --comment "the dialog overlaps the footer"` sends a task in `review` back to
`working`, records one `review_rejected` event as the user and keeps the comment as its repair
note (`decision_needed`), so the next attempt's brief starts from what the reviewer saw. Any other
status is refused. The live board offers the same two decisions on a `ui` task in review: Approve
runs the acceptance gate and Reject asks for the comment in a dialog; the page refetches once the
server records either, and a refusal from the gate stays next to the buttons. A snapshot cannot
write and shows the copyable `nf task accept` and `nf task reject` commands instead.

### When a UI change needs the user

NF measures the change from the accepted attempt's commits: the `git diff --numstat` from its
`base_commit` to its last recorded commit (or its branch), limited to the UI paths of `ui.review`.
It classifies the change as `small` or `large`, records it as a `ui_change` event, and shows it as
`ui change: small (42 lines, 2 files)` in `nf task show`, as `ui_change` in `--json`, and as the
detail's `UI change:` line on the board.

- `small`: within `maxChangedLines` and `maxChangedFiles`, with no new screen and no theme or token
  change. The coordinator accepts it without `--approved-by-user`, after checking the screenshots.
- `large`: a new route, page, screen, tab, dialog or modal component (an added `.tsx`, `.jsx`,
  `.vue` or `.svelte` file with one of those words in its path), a theme or design-token style, or
  a change past a threshold. `nf task accept` refuses with the reason and needs
  `--approved-by-user`, as before.

Without `ui.review` NF keeps the old behaviour: every `ui` task needs the user. A size NF cannot
measure (no git, no recorded base commit or commit, a diff git refuses) counts as large, so a
missing measurement never accepts a change silently. The board's Approve/Reject stay available for
both sizes.

## Liveness

`nf attempt reconcile` answers, without reading threads, how every live attempt is doing. It reads
T3's own `statev2.sqlite` projections read-only (`NF_T3_STATE`, default
`~/.t3/userdata/statev2.sqlite`) and classifies each `dispatching`, `active` or `unknown` attempt of
the project:

- `running`: the attempt's run is running and its turn items, provider turns or messages moved
  within `--stall-minutes` (default 20).
- `stalled`: the run is still running but nothing moved for that long.
- `waiting_input`: the run has an unresolved runtime request (a question or secret) on the thread.
- `finished_ok` / `finished_failed`: T3 already ended the run. A failure carries its class
  (`quota`, `throttled`, `auth`, `availability`, `context_exhausted`, `cancelled`, `interrupted`,
  `rolled_back`, `failed`) and the host's error message.
- `missing`: T3 has no thread for the attempt, or deleted it.

A `thread_send_reuse` attempt is judged by the run T3 created for its own `t3_thread_send`: T3
keeps that command's client request id in the user message id it projects
(`message:mcp:<command>:thread-send:<client request id>`), and the message names the run. Without
such a message it only counts runs requested after it started. An attempt with no recorded
`thread_id` binds to the thread behind it: the conversation its send landed in, else the delegated
thread T3 created for it — the one whose client request id is the attempt's, else the one whose
recorded brief names the attempt key under its own coordinator thread. Several sends into one
conversation count once, and a key named in two conversations binds neither, so the coordinator
need not hand the thread back. Until T3 creates it the attempt reads `running`; past
`--stall-minutes` from its start the thread never existed, so it is `missing` again. Human output
prints the last activity time and the evidence per attempt; `--json` returns the same as data.

```sh
nf attempt reconcile                     # read-only: report and the changes --apply would make
nf attempt reconcile --stall-minutes 45  # a slower threshold for long tool runs
nf attempt reconcile --apply             # record: missing -> unknown, finished_failed -> failed
```

`--apply` only marks a gone thread as `unknown` and a finished failure as `failed` (class and
detail from T3), and records a delegated attempt's binding as its `thread_id`, moving a
`dispatching` attempt whose thread is still running to `active`; it never marks a success and
never changes a task's status, and each change is an event on the task. `nf status` shows each
live attempt's liveness, and `nf board` puts it on the task cards: a stalled or missing thread
reads `Possibly stuck`, a question `Waiting for input`, and the reason behind either verdict sits
in a tooltip; every other state is only a dot.

## Location and links

An attempt records the branch, commits and pull request it produced; the board derives where the
task's code is from that, read-only, every time it renders:

```sh
nf attempt update NF-020-A1 --branch feat/x --add-commit <sha>
nf attempt update NF-020-A1 --pr 12          # or a full pull request URL; --pr '' clears it
```

`--pr` takes a pull request URL, or a number together with a GitHub origin remote. `nf attempt
show` prints it as `pr:`. The derivation reads the project's checkout with `git` (does the branch
or tag that defines a stage contain the attempt's commits?) and, when `gh` is installed, the pull
request state: the PR recorded on the attempt, else the most recent PR whose head is the branch.
`gh` runs as the origin's owner account when that account is signed in (`gh auth token --user
<owner>`, passed as `GH_TOKEN` for that call only), otherwise as the active one, so an unrelated
active account cannot hide the project; `nf` never switches accounts or changes gh's config.

- `branch`: a branch or commits were recorded and no pull request.
- `pr`: a pull request is recorded or found and not merged; its state shows `draft`, `open` or
  `closed`.
- `merged`: the commits are contained in the default branch, or `gh` reports the pull request
  merged.
- With environments configured: the furthest environment whose branch or tag contains the commits
  (or whose branch is the merged pull request's base, which catches a squash merge git cannot see).

Missing `gh`, a failed request, a missing checkout or an offline machine degrade to git only and
never fail the board. Nothing is cached in the store except the branch, commits and pull request
the user recorded. `TaskView.links` points at the pull request, the branch and the commits on
GitHub when the remote is a GitHub one; the board shows them in the task detail, pills the
location on the card metadata and filters the board by stage.

### Project config

`$NF_HOME/projects/<prefix>.yaml` (for example `~/.nf/projects/NF.yaml`) is per-project,
untracked, optional and validated with Effect Schema:

```yaml
t3DeepLinks: true # default; see below
defaultBranch: main # optional; detected from origin/HEAD, main or master otherwise
ui:
  themes: [light, dark] # default; a `ui` task captures one screenshot per theme
  review: # optional; without it every `ui` change needs the user
    paths: ['packages/board/src/**', '!packages/board/src/components/ui/**'] # default ['**']
    maxChangedLines: 150 # default
    maxChangedFiles: 6 # default
    newScreens: human # human (default) or coordinator
    themeOrTokens: human # human (default) or coordinator
stages:
  dev:
    branch: develop
  prod:
    branch: main
    label: Producción
    tone: success
  release:
    tag: "v*"
```

The file's order is the stage order. Each stage needs exactly one of `branch` or `tag`, may set a
`label` (the id otherwise) and a `tone` (`neutral`, `info`, `success`, `warning`, `destructive`);
stage ids are lowercase and may not reuse the built-in `branch`, `pr`, `merged` or `none`. Unknown
keys, both or neither selectors, duplicate selectors and empty values are rejected with the path of
the problem. Without the file the stages are `branch`, `pr` and `merged`; with environments they
become `branch`, `pr` followed by the environments.

`ui.themes` lists the themes a `ui` task captures (`light` and/or `dark`, at most once each); without
it the evidence needs a light and a dark screenshot. `--theme` refuses a theme the project does not
declare, and `nf task accept` requires one screenshot per declared theme.

`ui.review` decides who accepts a `ui` task's change. `paths` are globs matched against the changed
paths in order, so a `!` glob removes what an earlier one matched; the other defaults are `["**"]`,
150 changed lines and 6 changed files. `newScreens` and `themeOrTokens` name the actor for those
two kinds of change: `human` (the default) always needs the user's approval, `coordinator` leaves
the change to the thresholds. An empty `paths` list, a negative threshold and an unknown key are
rejected with the path of the problem.

`t3DeepLinks: true` (the default) makes an attempt's thread href
`t3code://threads/<environmentId>/<threadId>`, using the attempt's environment and falling back to
the project's coordinator environment; the thread id is URL-encoded. Set it to `false` to keep the
attempt's recorded thread link instead. T3's in-app browser asks "Open this t3code link?" on every
click; an external browser asks once per origin.

## Policy

`$NF_HOME/policy.yaml` is this machine's routing policy: profiles of ordered candidates, disabled
routes, the analysis mode and the recovery rules. `skills/nf-meta/references/policy.example.yaml`
is the template; `nf policy show` copies it when the file is missing and validates it.

```sh
nf policy show                              # --profile p, --json
nf policy check < capabilities.json         # merge a T3 orchestrator_capabilities result
                                            # --env <id> (default local), --file f
nf policy status                            # one line; exit 3 when stale (>24h) or never checked
nf policy propose < capabilities.json       # diff the policy against the catalog; --file f,
                                            # --env <id>, --reorder, --json; saves the proposal
                                            # --init writes a missing policy from the catalog
nf policy apply                             # write that proposal; --file p; timestamped backup
nf policy resolve bounded                   # first eligible candidate + delegate_task target
                                            # --env e, --exclude provider:model (repeatable),
                                            # --approved for a profile that needs the user's yes
nf route block --provider pi --model zai/glm-5.3 --reason quota --reset-at ISO --evidence "..."
nf route unblock --provider pi --model zai/glm-5.3     # or --all
nf route list
```

`nf policy check` caches the catalog per environment (migration v3 adds `catalog_snapshots` and
`route_blocks`) so the coordinator refreshes it only when `nf policy status` says it is stale.
Resolution needs a cached local catalog, skips a route blocked until its `reset_at` (or until
unblocked), validates every policy option against the catalog values, and prints the
`{providerInstanceId, model, options}` object `delegate_task` takes. YAML is read with `yaml`
2.9.1, pinned in `@nf/core`: it has no transitive dependencies, ships ESM types, and covers the
hand-edited flow mappings of the policy better than a subset parser would.

`nf policy propose` ranks the catalog routes from the versioned traits table
(`packages/core/src/policy/model-traits.yaml`: family, OpenRouter id, reasoning support and option
names, context window, per-profile ranks and options, and how many candidates a profile keeps)
plus the price chain and the active route blocks. It keeps the order the policy already has and
only appends new routes after it, best rank first (then the cheaper price); `--reorder` ranks the
existing candidates too and prints where each one moved. It prints one line per candidate to add,
reorder, remove or mark unavailable, the routes a profile's price rules keep out, and the models it
cannot classify, which are never added automatically. A model the catalog dropped is proposed for
`disabled`; a candidate whose provider instance is no longer in the catalog is removed (a pinned
one stays where it is and is reported as broken); a blocked route is reported where it is and left
alone; a candidate marked `pinned: true` is never moved. On a machine without `policy.yaml`,
`nf policy propose --init` plans against the template's caps and frontier profile, writes the file
in one step and prints what it wrote, so no approval or backup is involved. Otherwise nothing is
written except `$NF_HOME/policy.proposal.json`. `nf policy apply` refuses a proposal whose content
hash no longer matches `policy.yaml`, backs the previous file up next to it
(`policy.yaml.bak-<UTC>`), keeps comments, unknown keys and a profile's rules through the `yaml`
document API and validates the result with the Policy schema. `skills/nf-autoconfigure` wraps the
two commands and applies only after the user approves the printed diff.

### Price caps, allow-lists and the frontier profile

A profile in `~/.nf/policy.yaml` may carry `max_input_per_m` and `max_output_per_m` (USD per
million tokens, from the same price chain `nf stats` costs with), `models` (the model IDs the
profile may hold even without a price) and `requires_approval`. A profile with rules writes its
candidates under `candidates:`; a bare list keeps working and simply has no rules. To add the caps
and a frontier profile to this machine's file, edit it into this shape:

```yaml
profiles:
  bounded:
    max_output_per_m: 15
    candidates:
      - { provider: pi, model: opencode-go/deepseek-v4.1-flash, options: { thinking: max } }
  reasoning:
    max_output_per_m: 20
    candidates:
      - { provider: pi, model: openai-codex/gpt-6.1-sol, options: { thinking: medium } }
  frontier:
    requires_approval: true
    models: [ claude-fable-5-2, gpt-6-astra ]
    candidates:
      - { provider: claudeAgent, model: claude-fable-5-2, options: { effort: max } }
      - { provider: pi, model: openai-codex/gpt-6-astra, options: { thinking: high } }
```

A model priced above a cap is never proposed for that profile: an existing candidate stays where it
is and is reported as `over_cap` with its price, and a new one is listed under `over cap` instead of
being added. `nf policy resolve` skips an over-cap candidate with the same reason. A model with no
price is only proposed in a capped profile when the profile's `models` list names it. A profile with
`requires_approval: true` is never chosen by a skill: `nf policy resolve` exits non-zero until the
user agrees and the caller adds `--approved`. `nf policy show` prints each profile's rules after its
candidates, and `nf stats --by profile` lists these profiles like any other.

## Board

`nf board` writes one self-contained HTML snapshot of the current project: tasks, attempts,
acceptance, dependencies, usage, costs, liveness, attachments, the code location and links, and
telemetry, rendered by the Eskais UI blocks in English. Liveness comes from `nf attempt
reconcile`'s T3 reading when the state database is readable, and from the recorded attempt status
and usage timestamps otherwise. Three views share the page: the tasks view, whose AgentTaskBoard
switches between the board with its columns, the same tasks as a table and the backlog of proposed
tasks and to-dos still waiting on a dependency; the telemetry view of what reaching acceptance
cost per strategy, model or coordinator; and, on the live board only, the Git tab of the project's
repositories ([Live board](#live-board)). Every task opens in one dialog whose header carries its
stats and a git line, above a collapsible Changes section with the branch's commits, uncommitted
work and diff; a snapshot has no branch data and says so. The board's columns leave out proposals,
which live in the built-in backlog; the table and the search still list every task. Every backlog
row ends with a copyable `nf task approve <key>` (`renderBacklogActions`), in a snapshot and on
the live board alike; the toolbar's own project picker is hidden, because NF renders its selector
above the tabs, and the stage filter ends in **No code** for tasks without a derived location.

`TaskView.attachments` carries the attempt evidence in the shape the registry's `attachments`
item takes (`{ id, name, kind: "image" | "file", src, srcDark?, thumbnail?, thumbnailDark?, alt,
href? }`): a light and a dark screenshot of the same name become one item with `src`/`srcDark`,
and `href` always points at the full-size file. An attachment whose file is gone from
`$NF_HOME/artifacts` becomes a `file` item named after it, with no link, rather than a broken
image. In a snapshot the strip embeds a 320 px JPEG thumbnail (`thumbnail`/`thumbnailDark`, up to
8 MiB per board) and `src`/`href` stay `file://` links to the full-size image; the live board
serves the full image over `/artifacts` instead and needs no thumbnail.

`TaskView.location` is the derived stage (`{ stage, href? }`) and `TaskView.links` the pull
requests, branches and commits (`{ kind, href, label, state? }`); the snapshot also carries the
project's `stages` (`{ id, label, tone? }[]`) for the location track and the stage filter. Both
are derived by `code-location.ts` at snapshot time and are covered in
[Location and links](#location-and-links).

```sh
nf board                       # $NF_HOME/boards/<project>-<UTC timestamp>.html; prints the path
nf board --out board.html      # somewhere else
nf board --json-only           # the TaskView[] JSON the page embeds, for debugging
nf serve                       # the live board of every project (see below)
```

The page opens from `file://` with no network, so a snapshot still works offline and in an HTML
preview: React,
the board components, the compiled Tailwind stylesheet, the Geist font (base64 in the
`@font-face` rules) and the data JSON are all inlined; `page-checks.mjs` fails the build on any
`url()` that is not a `data:` URI.
`generatedAt` is the snapshot time, every relative time is computed against it, and the time zone
is the machine's (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The embedded JSON carries
the `TelemetryView` for each grouping the tab offers (strategy, model and coordinator), computed
by `telemetryView` in `packages/core/src/usage/telemetry.ts` from the same events and cost rules
as `nf stats`. Its totals are the project's tasks alone: the coordinator thread is its own row and
is never added to a task metric, so the tab shows its spend beside the cost, not inside it. The
tab puts cost to acceptance and cost against first pass side by side (stacked horizontally per
strategy, model or coordinator, and a scatter sized by the task count), then a full-width cache
card (cache read share per context transfer or model, the savings at the price chain, and the cost
per accepted task with repairs apart) and a full-width cost per day with stacked workers and
coordination series, a legend with both totals, and their total (the same total as `nf stats`).
The table adds each row's cache read share.

`packages/board` holds the Eskais UI components and the entry that renders them; the NF → view
mapping is `boardViews` in `packages/core/src/board/board-view.ts`. The board's `TaskView` has no
strategy field, so the recorded strategy is only in `nf task show`, `--json`, `nf stats` and the
board's telemetry tab. The page's data comes from TanStack Query (`@tanstack/react-query`, pinned
to an exact version): a snapshot boots it with the embedded payload as `initialData` and never
refetches, while `nf serve` answers the same shape and the page polls `["board", project]` every
5 s (`refetchInterval: 5000`, not in a background tab). The components come from the
public `p-otero/eskais-ui` registry pinned to the Eskais UI v0.2.11 tag
(`refs/tags/v0.2.11`) in `packages/board/components.json`, and are installed with shadcn (`theme`,
`theme-glass`, `font-geist`, `floating`, `card`, `liveness-indicator`, `appearance`,
`agent-task-board`, `badge`, `chart`, `data-table`, `meter`, `stat`, `tabs`, `attachments`,
`lightbox`, `stage-track`, `list-item`, `textarea`, `repository-select`, `commit-history`,
`git-diff`, `git-tree`); the `shadcn` devDependency stays on the exact version that wrote them,
and `@ui-sdk/*` on `0.1.0-beta.12`, the exact beta the board was checked against
(`bun run board:install` re-installs from that shadcn and re-pins the betas). The entry uses the
glass theme and follows the system light/dark scheme through the installed `Appearance` API; the
task dialog stays opaque over it. Those component files are generated, so the repo formatter and
linter skip them. The board uses the generated built-ins instead of patching or filling slots:
`TaskView.attachments` renders through the registry's `attachments` strip (with its `lightbox`) in
the detail and as a paperclip count on the card, `stages` with `TaskView.location` gives the
card's `StagePill`, the detail's `StageTrack` and the toolbar's `StageFilter` with a count per
stage, `filters.stage` is the board's own filter state, `filterControls` leaves out the generated
project picker, `labels.filters.noStage` reads **No code**, and `view: "backlog"` is the board's
own proposed and not-ready view. The checked entry (`src/main.tsx`, `src/contract.ts`) and the NF
components around it (`src/components/nf`: the page with its views and filters, the approve command
in each backlog row, the review actions with their reject dialog, the telemetry tab with its chart
files, and its `ShareBar` and `SampleSizeBadge`, whose thresholds live in
`src/components/nf/telemetry-config.ts`) are the only code NF owns in the board. The provider and
model-vendor marks are SVG data URIs from `src/components/nf/provider-logo.tsx`, copied from T3
Code (MIT) and LobeHub Icons (MIT), and the T3 app mark of the Open in T3 button sits in
`src/components/nf/t3-logo.tsx`; each notice sits next to that data.

`bun install` builds the bundle into `packages/board/dist/index.html` (gitignored) through
`bun run board:build`, which needs no network. `nf board` rebuilds it with the same script when it
is missing or older than `packages/board/src`, `components.json` or `package.json`, and fails with
the build's output instead of writing a snapshot of a stale bundle.

### Live board

`nf serve` runs one server for every project in `$NF_HOME`, bound to `127.0.0.1` only (port 4646
by default; `--port 0` picks a free one). It serves the same page `nf board` builds, but the page
reads its data from the server and refetches every 5 seconds while its tab is visible, so the board
follows the store without a model turn. A live page can also record a review decision: `POST
/api/tasks/<KEY>/accept` runs the same gate as `nf task accept --approved-by-user` and `POST
/api/tasks/<KEY>/reject` takes the required `{ "comment" }` of `nf task reject`. Both answer
the gate's own message with 409 when it refuses, and everything they record is a `user` event.

```sh
nf serve                       # http://localhost:4646/ (every project)
nf serve --port 5000
```

The write routes exist for that page alone: `nf serve` makes a random token per run, embeds it in
the served HTML and requires it in `X-NF-Board-Token`; the request's `Origin` and `Host` must be
this server's own origin, the body must be JSON of at most 16 KiB, and no CORS header is ever
sent. Each decision is one transaction with its event, attributed to `user`; the page refetches
the board once it succeeds and shows the server's message inline when it does not.

Register it once per project with `nf t3 init`, which merges the Board script into T3 Code's
checked-in project file `t3.json` at the root of the registered checkout. It creates the file with
T3's `$schema` when it is missing, updates that one script in place on a rerun, and leaves every
other script and key as written:

```sh
nf t3 init                     # Board -> nf serve, preview http://localhost:4646/?project=NF
nf t3 init --port 5000         # nf serve --port 5000, preview on 5000
```

The merged entry is the same in every project's file, and only its `previewUrl` names the prefix:

```json
{ "name": "Board", "command": "nf serve", "icon": "play", "previewUrl": "http://localhost:4646/?project=NF", "autoOpenPreview": true, "runOnWorktreeCreate": false }
```

T3 Code reads it from the checkout: in the project's Actions settings choose **Import scripts** ->
**Import from t3.json** (a thread's scripts menu lists it under **From t3.json**).
`autoOpenPreview` opens the URL in T3's in-app browser, and `runOnWorktreeCreate: false` keeps it
out of a fresh worktree.

One server serves the whole store: a second `nf serve` on the same port finds the running one
through `GET /api/health` (`{ app: "nf", version, nfHome }`) and exits 0, so several worktrees and
threads share it. A running server whose `nfHome` differs is refused with an error rather than answered
from another store, and a port held by anything else fails with a clear message. There is no
daemon: the script's terminal owns the process and stopping the script stops the server.

`GET /api/board[?project=<PREFIX>]` answers the JSON the snapshot embeds: `tasks` (for one project,
exactly what `nf board --json-only` writes), `stages`, `telemetry`, `project` (`null` for every
project), `projects` and `generatedAt`/`timeZone`. Without `project` it is every project's board.
Each request rebuilds the payload from SQLite; nothing is cached in the store and no route changes
anything. The one thing kept between requests is the git and `gh` derivation behind a task's
location and links, in memory for five minutes: one `gh pr list` per repository answers every
recorded pull request and attempt branch of it (an older pull request costs one lookup), a request
that finds those facts stale still answers from them, and one background refresh warms their
replacement, so only the first request after a start waits for them (a merge outside NF shows up
that much later, or after a restart). Every answer carries an `ETag` over the data (not over its
render time), so an unchanged board can revalidate with `304`. Attachments are not inlined over
HTTP: their `src`, `srcDark` and `href` point at `/artifacts/<id>`, which serves a recorded
attachment from `$NF_HOME/artifacts` after checking the file is inside that tree and answers 404
for anything else. The page's project selector switches project (or shows all of them) and keeps
the choice in the URL with `history.replaceState`, without a reload.

The Git tab and a task's Changes section read git through the same server, from read-only
`GET /api/git/{repos,branches,log,commit,compare,worktree}?project=<PREFIX>` and
`GET /api/tasks/<KEY>/branch` routes that answer from the project's workspace folder and refuse
a path outside it. A snapshot has no git at all: no Git tab, and its task dialog says it has no
branch data.

## Releasing

The published package is `packages/nf` (`@p-otero/nf-stack`); a `v*` tag publishes it from GitHub
Actions. Bump `packages/nf/package.json` and `packages/cli/package.json` to the same version (a test
keeps them equal, and `nf --version` reports the published one), then tag and push:

```sh
git commit -am "Release 0.1.1"
git tag v0.1.1
git push origin main v0.1.1
```

`release.yml` runs `bun run verify`, refuses a tag that does not name the package version, builds
and publishes with `--provenance --access public`. The first release authenticates with an
`NPM_TOKEN` repository secret (passed as `NODE_AUTH_TOKEN`); once the package exists on npm,
configure it as a trusted publisher for this repository's `release.yml` and delete the secret, and
the workflow publishes through the OIDC token with no secret at all.

## License

NF-Stack is MIT licensed (see [`LICENSE`](LICENSE)). The repository and the npm package redistribute
third-party work, the board's bundled libraries and fonts, the CLI's bundle and the vendored
`ui-sdk` skill; their licenses and copyright lines are in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md), which ships in the package.

## Development

```sh
bun run verify       # lint (oxlint + Effect rules), fmt check, typecheck, board typecheck, tests
bun run fmt          # format
bun run board:build  # rebuild the board bundle after changing packages/board or a view type
```

Tests always use a temporary `NF_HOME`; the CLI smoke test executes `nf` with `node`. TypeScript
is limited to erasable syntax (no enums, namespaces or parameter properties) and `.ts` import
extensions so Node can strip types; `@nf/core` must not use Bun-only APIs. Without linking the bin,
run the CLI from the checkout with `node packages/cli/bin/nf.js <args>`. See
[`docs/architecture.md`](docs/architecture.md) and [`AGENTS.md`](AGENTS.md) for the Effect conventions.
