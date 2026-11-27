# NF-Stack architecture (Effect 4)

NF runs on Effect 4 so it can move into Eskais and swap SQLite for Postgres with minimal rewrite.
Sources compared: T3 Code (`AGENTS.md`, `docs/internals/effect-services.md`, `packages/contracts`,
`apps/server/src/*`, `.repos/effect/LLMS.md`), the Effect 4 repo (`LLMS.md`, `ai-docs/`,
`packages/sql/*`, `effect/sql`, `effect/cli`) and Eskais (`AGENTS.md`, `docs/ARCHITECTURE.md`,
`.oxlintrc.json`, `sgconfig.yml`, `packages/persistence`). Where they disagree, Eskais wins.

## Packages and folders

| Path                                        | Role                                                                                               | Source                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/contracts` (`@nf/contracts`)      | Effect Schemas, `as const` constants, `NfError`, board view types. Depends only on `effect`.        | T3 `packages/contracts`; Eskais `contracts` + semantic-literal rule           |
| `packages/core/src/domain`                  | Pure rules: keys and project prefixes, ids, transitions, liveness classes, usage math, prices      | T3 "orchestration stays pure"                                                |
| `packages/core/src/attempts`                | Workflows over the store and a source: `attemptLiveness` (reconcile), `uiChangeOf` (the `ui.review` size) | T3 services/workflows                                                  |
| `packages/core/src/persistence`             | The only SQL on the NF store: SQLite layer, migrations, `TaskStore`, import, usage writes/queries, subagent spawns, backup | Eskais persistence boundary (`*.persistence.ts`, raw SQL only there)        |
| `packages/core/src/sources`                 | Read-only adapters for T3 `statev2.sqlite`, Pi JSONL, LiteLLM rates and the OpenRouter catalog, decoded with Schema | T3 "complexity at the adapter boundary"; Eskais "validate every boundary"   |
| `packages/core/src/usage`                   | Sync and stats workflows over the store and sources                                                 | T3 services/workflows                                                        |
| `packages/core/src/policy`                  | Policy file loading, catalog merge, propose/apply and resolve/status workflows                      | T3 services/workflows                                                        |
| `packages/core/src/system`                  | Node seams: `NF_HOME`, git discovery, skills linking, board page assembly                           | —                                                                            |
| `packages/core/src/git`                     | Read-only git views for `nf serve`: workspace repositories, branches, log, commits, compare, worktree, task branch | —                                                                            |
| `packages/cli` (`@nf/cli`)                  | Thin transport: parse argv, call core, format, map errors to exit codes                             | T3 "transports stay thin"                                                    |
| `packages/board` (`@nf/board`)              | React entry and the Eskais UI Agent Task Board (shadcn, pinned registry), prebuilt to one HTML page | Eskais UI contract v1                                                        |
| `packages/nf` (`@p-otero/nf-stack`)         | The published package: `bun build` bundles the CLI and `@nf/*` into `dist/main.js` (so no `.ts` loads from `node_modules`), copies the board page, the model traits and `skills/nf-*`, and `prepack` rebuilds all of it | — |

Files are kebab-case and modules with store queries end in `.persistence.ts` (Eskais); the layer
and migration wiring sits next to them. Workspace packages export TypeScript sources; Node 24 strips
types at load (no build step) — the board is the exception, a React bundle prebuilt once by
`bun run board:build` so `nf board` only embeds the snapshot JSON (and rebuilds the bundle itself
when it is older than the board sources, `packages/core/src/system/board-bundle.ts`).
`packages/nf` is the other exception and for the opposite reason: Node refuses to strip types under
`node_modules`, so the published package ships `dist/main.js`, one plain-JavaScript bundle of the
CLI and `@nf/*` with only `sharp` external, and the files the bundle reads by URL are copied beside
it (`dist/model-traits.yaml`, `dist/board/index.html`) or next to the manifest (`skills/`). Those
paths resolve to the checkout while nf runs from source, so both layouts run the same code. `boardViews`
(`packages/core/src/board/board-view.ts`) is the NF → `TaskView` adapter; it reads the store and
`usage_events`, takes liveness from T3's projections when the caller passes the state database
(else from the recorded status and usage timestamps) and validates its own output against the
contract Schema, while
`telemetryView` (`packages/core/src/usage/telemetry.ts`, with its cache and daily builders in
`telemetry-cache.ts` and its shared quantities in `telemetry-metrics.ts`) groups the same events
into the board's `TelemetryView`, reusing the cost rules of `nf stats` and adding cache read
share, cache savings from the price chain, cost per accepted task and cost per UTC day, and
`packages/board` keeps the Eskais types and the `nf`-agnostic rendering.

`boardViews` also emits `TaskView.location` and `TaskView.links`
(`packages/core/src/board/code-location.ts`): the location is derived read-only at snapshot time
from the project checkout (`git` containment of the attempt's commits in the default branch, an
environment branch or a tag) and, when `gh` is available, the pull request state; a missing `gh`,
network or checkout degrades to git only. Links point at the pull request, branch and commits on
GitHub when the remote is a GitHub one. Nothing derived is stored: the store keeps only the
branch, commits and `pr_url` the user recorded. The stage list defaults to `branch` -> `pr` ->
`merged` and is replaced by the ordered environments of `$NF_HOME/projects/<prefix>.yaml`
(`packages/core/src/system/project-config.ts`, validated with Effect Schema), which also declares
the `ui` task's evidence themes (`ui.themes`, default light and dark) and enables the
`t3code://threads/<environment>/<thread>` thread href (on by default). That file's `ui.review`
block decides who accepts a `ui` task's interface change: `paths` are globs matched in order
against the changed paths of the accepted attempt's diff (`base_commit` to its last commit or
branch), a `!` glob removing what an earlier one matched
(`packages/core/src/domain/ui-change.ts`); the defaults are `["**"]`, `maxChangedLines: 150`,
`maxChangedFiles: 6`, and `newScreens`/`themeOrTokens: human`. A new screen (an added `.tsx`,
`.jsx`, `.vue` or `.svelte` file whose path or name has a route, page, screen, tab, dialog or modal
word) or a theme/token style makes the change large when its decision is `human`; both can be
lowered to `coordinator` to leave it to the thresholds. A `large` change needs
`--approved-by-user`; a `small` one does not but still needs one screenshot per theme. Without
`ui.review` every `ui` task needs the user, as before, and an unmeasurable size (no git, no
recorded base or commit) counts as large. Acceptance records the verdict as a `ui_change` task
event (`packages/core/src/attempts/ui-change.ts`), shown as `ui change: …` by `nf task show` and as
`TaskView.uiChange` on the board; both compute it from git when no verdict is recorded yet, so a
review shows its size before the decision. `TaskView.attachments` follows the same
pattern (`{ id, name, kind, src, srcDark?, thumbnail?, thumbnailDark?, alt, href? }`, from
`packages/core/src/board/attachment-view.ts`): a light and a dark screenshot of the same name pair
into `src`/`srcDark`, recordings and other files stay `kind: "file"`, and `href` is always the
absolute `file://` URL of the full-size artifact. An attachment whose file is missing becomes a
`kind: "file"` item named after it with no `href`, so a snapshot or a live board shows a
placeholder instead of a broken image. A UI task also carries the `UI` label. The
snapshot embeds a 320 px JPEG thumbnail as a data URI (at most 8 MiB per board) and keeps the
full-size image a `file://` link; the live board serves the full image over `/artifacts`. The
registry pinned in
`packages/board/components.json` (Eskais UI v0.2.1, `7d38f15`) builds the attachments, stages and backlog into its
`agent-task-board`, so NF only supplies `TaskView.attachments`, `stages` and `TaskView.location`:
`AttachmentStrip` (and its lightbox) renders in the task detail and the paperclip count on the
card, `StagePill`/`StageTrack` show the location, `filters.stage` drives the toolbar's
`StageFilter` with a count per stage, and `view: "backlog"` is the proposed and not-ready view.
The page owns the board's `view` and `filters` and keeps them across a poll. `renderBacklogActions`
puts the copyable `nf task approve <key>` command at the end of each backlog row, in a snapshot and
live; `renderCardActions` puts Approve/Reject on a `ui` task in review (`TaskView.awaitingApproval`)
and the copyable `nf task accept|reject` commands in a snapshot, and `renderAttachments` adds the
same actions under the detail's evidence, above the `UI change: …` line of `TaskView.uiChange`;
`filterControls` hides the generated project picker in
favour of NF's own and the stage filter's last toggle is `NO_STAGE` with `labels.filters.noStage` of
**No code**. A snapshot needs no server. `src/lib/agent-task-types.ts` and
`src/components/ui/task-detail-content.tsx` stay exactly what `bun run board:install` wrote.

## Schema

`$NF_HOME/nf.db` is the only database NF writes; `$NF_HOME/machine-id` names the machine. Its
`PRAGMA user_version` is the schema version: `persistence/migration-sql.ts` holds one SQL text per
version and `persistence/migrations.ts` applies them (see [Change policy](#change-policy)).
**v10 is the stable baseline** reviewed here. Row counts are from a copy of a real store (three
projects, 31,550 usage events, taken 2026-11-17); they show what the store holds, not a limit.

Portability rules for the planned Postgres layer: TEXT ULIDs, ISO-8601 UTC timestamps, JSON as TEXT,
booleans as INTEGER `0`/`1`, `INTEGER`/`REAL` numbers, `TEXT` primary keys, no `AUTOINCREMENT` and no
SQLite-only function in a query. Anything that breaks one of them is a finding below.

### Tables

`Writers` names the modules that insert or update rows; a table nobody writes is read-only data.

| Table | Rows | Purpose | Writers | Columns |
| --- | --- | --- | --- | --- |
| `projects` | 3 | One checkout per store; its `prefix` starts every task key | `projects.persistence.ts` (`registerProject`, `setProjectPrefix`), `project-prefix.persistence.ts` (v6 step), `import.persistence.ts` (coordinator fields) | `id`, `machine_id`, `name`, `prefix` (v6, unique), `root_path` (unique), `remote_url`, `coordinator_environment_id`, `coordinator_thread_id` (legacy main coordinator), `coordinator_thread_link` (recorded, never read), `created_at` |
| `tasks` | 44 | One unit of delegated work and its state | `tasks.persistence.ts` (`addTask`, `updateTask`), `task-brief.persistence.ts` (`editBrief`, title and goal), `task-transitions.persistence.ts` (`setStatus`, `acceptTask`, `checkItem`, `intervene`), `attempts.persistence.ts` (`startAttempt`, `finishAttempt`), `import.persistence.ts`, `project-prefix.persistence.ts` (keys) | `id`, `machine_id`, `project_id`, `seq` (per-project ordinal), `key` (`<prefix>-<seq>`, unique with project), `title`, `goal`, `status` (7 values), `profile`, `analysis_mode` (`review`/`autonomous`), `strategy` (v4, 5 values), `ui` (v7 flag), `authorization`, `decision_needed` (text for a person), `blocker` (JSON), `evidence`, `accepted_first_pass` (0/1/NULL = no verdict), `human_interventions`, `source`, `design_ref`, `superseded_by` (self FK), `created_at`, `updated_at` |
| `task_acceptance` | 179 | Acceptance items of a task, in order | `tasks.persistence.ts` (create), `task-brief.persistence.ts` (`editBrief`), `task-transitions.persistence.ts` (`checkItem`), `import.persistence.ts` | `task_id`, `position` (PK with task), `text`, `result` (`pass`/`fail`/`unverified`), `evidence` |
| `task_deps` | 25 | "A needs B before it is ready" edges | `tasks.persistence.ts` (`insertDependency`), `import.persistence.ts` | `task_id`, `depends_on_task_id` (PK together, self FK, never equal) |
| `attempts` | 48 | One dispatch of a task to a model or thread, with its recovery checkpoint | `attempts.persistence.ts` (`startAttempt`, `updateAttempt`, `finishAttempt`), `coordinators.persistence.ts` (v9 backfill and `nf sync`), `import.persistence.ts` | `id`, `machine_id`, `task_id`, `seq`, `key` (`<task key>-A<seq>`), `kind` (5), `status` (7), `mechanism` (5), `environment_id`, `thread_id`, `thread_link`, `t3_task_id`, `client_request_id` (idempotent start; defaults to `<project name>-<attempt key>`), `provider_instance_id`, `model` (configured), `options` (JSON), `executed_model`, `profile`, `strategy`, `coordinator_thread_id`, `coordinator_model`, `reason`, `fallbacks` (JSON array), `context_mode` (`fresh`/`fork`/`reuse`/`compact`), `source_thread_id`, `repair_of` (self FK), `started_at`, `ended_at`, `base_commit`, `worktree`, `branch`, `pr_url` (v8), `diff_location`, `outcome`, `failure_class`, `failure_detail`, `retry_at`, `last_verified`, `remaining`, `updated_at` |
| `attempt_commits` | 56 | Commits an attempt recorded | `attempts.persistence.ts` (`--add-commit`), `import.persistence.ts` | `attempt_id`, `position`, `sha` (PK with attempt) |
| `attempt_checks` | 0 | Commands an attempt ran and their result | `attempts.persistence.ts` (`--add-check`) | `attempt_id`, `position` (PK with attempt), `command`, `result` (`pass`/`fail`/`not_run`), `detail` |
| `attempt_reports` | 65 | Append-only `nf attempt report` bodies | `reports.persistence.ts` (`addReport`) | `id`, `machine_id`, `attempt_id`, `kind` (`checkpoint`/`result`), `body`, `created_at` |
| `task_events` | 663 | Append-only audit trail of every task change | `TaskStore.event` from every write path | `id`, `machine_id`, `task_id`, `attempt_id`, `kind`, `actor_role` (5), `from_status`, `to_status`, `note`, `created_at` |
| `usage_events` | 31,550 | One synced Pi/T3 usage measurement, its price and its attribution | `usage.persistence.ts` (sync: `persistEvents`, `reattributeEvents`) | `id`, `source` (`t3`/`pi`), `source_key` (unique), `machine_id`, `t3_thread_id`, `native_session_id`, `run_id`, `turn_id`, `provider`, `model`, `ts`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `usage_status` (`complete`/`partial`/`unavailable`), `is_subagent` (0/1), `cost_usd`, `cost_quality` (`reported`/`estimated`/`unknown`), `price_source`, `price_date`, `attempt_id`, `parent_attempt_id` (v5), `bucket` (`attempt`/`coordination`/`unattributed`), `created_at` |
| `sync_state` | 2 | Last result and cursor per source | `usage.persistence.ts` (`writeSyncState`) | `source` (PK, `t3`/`pi`), `cursor`, `last_run_at`, `last_status` (`ok`/`partial`/`failed`), `last_error`, `inserted`, `updated`, `skipped` |
| `catalog_snapshots` | 1 | Last catalog a route policy was proposed from | `policy.persistence.ts` (`saveCatalog`) | `environment_id` (PK), `machine_id`, `checked_at`, `providers` (JSON), `created_at`, `updated_at` |
| `route_blocks` | 1 | A blocked provider route | `policy.persistence.ts` (`upsertRouteBlock`, `removeRouteBlock` deletes) | `id`, `machine_id`, `provider_instance_id`, `model`, `reason` (`quota`/`auth`/`availability`/`other`), `reset_at`, `evidence`, `blocked_at`, `updated_at` |
| `subagent_spawns` | 145 | A child thread a T3 thread spawned, from the sync | `subagent.persistence.ts` (`persistSpawns`, `reattributeSpawns`) | `id`, `source_key` (unique), `parent_t3_thread_id`, `parent_run_id`, `child_t3_thread_id`, `provider`, `model`, `kind` (`app_owned`/`native`), `started_at`, `ended_at`, `attempt_id`, `created_at` |
| `attempt_attachments` | 131 | Recorded screenshots, recordings and files of an attempt | `attachments.persistence.ts` (`addAttachment`) | `id`, `machine_id`, `attempt_id`, `kind` (`screenshot`/`recording`/`file`), `theme` (`light`/`dark`), `name`, `path`, `bytes`, `sha256`, `created_at` |
| `coordinator_threads` | 0 | Extra coordinator threads of a project (v9) | `coordinators.persistence.ts` (`registerCoordinatorThread`, which also re-derives the project's attempts without a coordinator) | `project_id`, `thread_id` (PK with project), `created_at` |

A writing attempt (`implementation`, `integration`) steps its task along the contract: `startAttempt`
moves it `todo` → `working` and a `succeeded` attempt moves it `working` → `review`, each with a
`status` task event whose note is the attempt key. A `failed`, `cancelled` or `superseded` attempt
leaves the task `working`; a task a person, a rejection or an integration already moved elsewhere is
never forced along, and research, design and review attempts change no status. Every step is one the
transition table already allows.

### Indexes

Every `PRIMARY KEY` and `UNIQUE` adds SQLite's implicit `sqlite_autoindex_<table>_<n>`; they are
listed with the lookups they serve. `Used by` is what `EXPLAIN QUERY PLAN` reports for the queries
in `persistence/**` on the reference store.

| Index | Table and columns | Used by |
| --- | --- | --- |
| `sqlite_autoindex_projects_1`, `_2` | `projects (id)`, `(root_path)` | identity; the `root_path` invariant (path lookups run in `listProjects`) |
| `projects_prefix` | `projects (prefix)` UNIQUE | `prefixOwner`/`ensurePrefixFree`; created by the v6 data step |
| `sqlite_autoindex_tasks_1`, `_2`, `_3` | `tasks (id)`, `(project_id, key)`, `(project_id, seq)` | identity, `findTaskRow`, sequence order |
| `tasks_project_status` | `tasks (project_id, status)` | status counts, ready/live scans, coordinator stats |
| `sqlite_autoindex_task_acceptance_1` | `task_acceptance (task_id, position)` | the items of a task in order |
| `sqlite_autoindex_task_deps_1` | `task_deps (task_id, depends_on_task_id)` | dependency walk, cycle check, load |
| `sqlite_autoindex_attempts_1`, `_2`, `_3` | `attempts (id)`, `(task_id, seq)`, `(task_id, key)` | identity, `findAttempt`, per-task order |
| `attempts_task_status` | `attempts (task_id, status)` | live-writer check, live attempts, ready tasks |
| `attempts_one_live_writer` | `attempts (task_id)` UNIQUE partial, live writing statuses | invariant: one writing attempt per task |
| `attempts_client_request` | `attempts (task_id, client_request_id)` UNIQUE partial | idempotent `nf attempt start` |
| `sqlite_autoindex_attempt_commits_1` | `attempt_commits (attempt_id, sha)` | commit dedupe and load |
| `sqlite_autoindex_attempt_checks_1` | `attempt_checks (attempt_id, position)` | checks of an attempt |
| `attempt_reports_attempt` | `attempt_reports (attempt_id, id)` | reports of an attempt |
| `task_events_task` | `task_events (task_id, id)` | events of a task |
| `sqlite_autoindex_usage_events_1`, `_2` | `usage_events (id)`, `(source_key)` UNIQUE | identity; sync idempotency |
| `usage_events_attempt`, `usage_events_parent_attempt` | `usage_events (attempt_id)`, `(parent_attempt_id)` | stats per attempt, the board's attempt scope |
| `usage_events_thread_ts` | `usage_events (t3_thread_id, ts)` | `closestTurn` and `followingTurn` (coordinator at or before a time, else the first after it) |
| `usage_events_bucket` | `usage_events (bucket)` | coordination-turn stats |
| `sqlite_autoindex_sync_state_1` | `sync_state (source)` | one row per source |
| `sqlite_autoindex_catalog_snapshots_1` | `catalog_snapshots (environment_id)` | one snapshot per environment |
| `sqlite_autoindex_route_blocks_1`, `_2` | `route_blocks (id)`, `(provider_instance_id, model)` UNIQUE | identity; one block per route |
| `sqlite_autoindex_subagent_spawns_1`, `_2` | `subagent_spawns (id)`, `(source_key)` UNIQUE | identity; sync idempotency |
| `subagent_spawns_parent` | `subagent_spawns (parent_t3_thread_id, started_at)` | coordinator spawn counts |
| `subagent_spawns_attempt` | `subagent_spawns (attempt_id)` | spawn groups and per-attempt counts |
| `attempt_attachments_attempt` | `attempt_attachments (attempt_id, id)` | attachments of an attempt |
| `sqlite_autoindex_coordinator_threads_1` | `coordinator_threads (project_id, thread_id)` | the project's threads |

v10 dropped `usage_events_ts`, `task_deps_reverse`, `coordinator_threads_thread` and
`subagent_spawns_child`: no statement constrained those leading columns, and every read that could
have used them constrains another column first (`TEMP B-TREE` sorts for the tiny result sets are
cheaper than the write cost).

### Findings

| Finding | Evidence | Decision |
| --- | --- | --- |
| Four indexes were never read | Every plan for the v9 store avoids `usage_events_ts`, `task_deps_reverse`, `coordinator_threads_thread` and `subagent_spawns_child`; writes paid for them on 31,550 usage events | Dropped in v10; an additive migration re-adds one when a query needs it |
| Coordinator threads have two homes | `projects.coordinator_thread_id` (1 row here) and `coordinator_threads` (0 rows) express the same role; `threadsIn` and `loadAttributionIndex` union both | Deferred: moving the value into the registry and dropping the two project columns touches `nf project`, `import`, the `Project` contract and `nf status --json` output |
| `projects.coordinator_thread_link` is stored, never read | Written only by `nf project --coordinator-thread-link` and the import; no behavior reads it | Deferred with the row above; removing it changes the published `Project` shape |
| `attempts.thread_link` is a fallback, not the source | `threadHrefOf` derives `t3code://threads/<environment>/<thread>` and uses `thread_link` only when no environment is known (2 rows here) | Keep: recorded external links are data the store cannot derive |
| `attempts.diff_location` is superseded | 0 rows; `branch`, `commits`, `pr_url` and the derived location replace it; only `nf attempt show` prints it | Deferred: removing `--diff-location` is a CLI change, not a schema-only one |
| `attempts.executed_model` looks unused but is not | 0 rows here, yet it records what actually ran when a route substituted the configured `model`; the board renders the difference | Keep |
| `attempt_checks` has no rows | `nf attempt update --add-check` writes it; no attempt in this store recorded a check | Keep; unused data, not an unused column |
| Three evidence channels | `tasks.evidence`, `task_acceptance.evidence` and `attempt_reports.body` each hold proof at a different level | Keep; naming only, each has a writer and a reader |
| `tasks.decision_needed` and `tasks.blocker` overlap | Both answer "why is this not moving": free text for a person and structured JSON for a workflow | Keep (both are contract fields); the difference is documented here |
| Child-thread attribution never fired | `usage_events.parent_attempt_id` and `subagent_spawns.attempt_id` are 0 rows: every spawn's parent is a coordinator thread, so coordinator spawns are counted by `parent_t3_thread_id` | Not dead; the path fills when a parent thread hosts an attempt |
| Naming is inconsistent | `t3_` prefix only in `subagent_spawns.parent_t3_thread_id`/`child_t3_thread_id` and `attempts.t3_task_id`; `coordinator_thread_id` names three different roles; `attempt_commits` keys on `(attempt_id, sha)` while `attempt_checks` keys on `(attempt_id, position)` | Deferred: renaming columns is a rebuild and would touch every query |
| Derived columns are maintained by code | `tasks.seq`/`key` and `attempts.seq`/`key` duplicate each other and are rewritten by `rewriteProjectKeys` with `printf('%03d')` | Documented for the Postgres layer, where the format becomes `lpad`/`to_char`; no change now |
| No missing index for today's queries | `EXPLAIN QUERY PLAN`: every filtered read of a large table uses an index; the scans are the stats views and the sync, which want every `usage_events` row, plus whole-table reads of tables under 200 rows | None added in v10 |
| `tasks.key` alone is not indexed | `findTaskRow` always filters `project_id` first; a lookup by canonical key across projects (the review actions in NF-034) would scan | Deferred to that change: `CREATE INDEX tasks_key ON tasks (key)` is additive |
| The project-scope stats query cannot use an index | `selectStatsEvents` filters through `t.project_id`/`pt.project_id` in an `OR` across three joins, so SQLite scans 31,550 events (13-30 ms); `COALESCE(e.attempt_id, e.parent_attempt_id)` in the strategy/context/coordinator cost queries does the same (8-20 ms) | Deferred: a union of indexed lookups is a query change that must keep output byte-identical |
| `closestTurn` sorts its last ordering term | The plan uses `usage_events_thread_ts` and a temp B-tree for `id DESC` among equal `ts`; the sort covers a handful of rows | Deferred: a wider `(t3_thread_id, ts, id)` index does not pay for itself |
| `REAL` cost | `usage_events.cost_usd` is a floating-point sum of prices; `toFixed` in the stats views hides it today | Postgres maps it to `numeric(18, 8)`; a change here is a rebuild |
| Append-only is not universal | `task_events` and `attempt_reports` reject UPDATE/DELETE with triggers; `usage_events` and `subagent_spawns` are projections the sync rewrites (`attempt_id`, `parent_attempt_id`, `bucket`, measured fields) | The two logs are append-only; the projections are not, by design |
| Triggers are SQLite syntax | `BEFORE UPDATE ... BEGIN SELECT RAISE(ABORT, ...); END` | A Postgres layer needs a trigger function (or a revoked UPDATE grant) for the same invariant |
| Versioning is SQLite-specific | `PRAGMA user_version`, `foreign_keys`, `foreign_key_check`, `VACUUM INTO` live in the layer and the migration runner | Postgres uses `Migrator` and `pg_dump`; no query in `persistence/**` reads `sqlite_master` |
| JSON is TEXT without a database check | `tasks.blocker`, `attempts.options`/`fallbacks`, `catalog_snapshots.providers` | Validated with Schema in the domain where it is read; a `json_valid` CHECK would be SQLite-only |
| Machine-local keys in a global store | `projects.root_path`, `projects.prefix`, `projects.name`, `usage_events.source_key`, `subagent_spawns.source_key` and `sync_state.source` (PK) are unique across the whole store; a shared Postgres store would collide on two machines with the same paths or source keys. `subagent_spawns` and `sync_state` also lack `machine_id` | Deferred: the merged-store design (compose with `machine_id`) is a rebuild plus an API decision |

### Measured plans

Median of 25 runs on the reference store (v9 copy and the same store migrated to v10; the DB was
warm and measurements interleaved). Plans are identical before and after v10.

| Query | Plan | v9 | v10 |
| --- | --- | --- | --- |
| `selectStatsEvents` (all projects) | scan `usage_events` + PK joins | 68-73 ms | 69-75 ms |
| `selectStatsEvents` (attempts of the board) | multi-index `OR` on `attempt_id`/`parent_attempt_id` | 13-18 ms | 14-15 ms |
| `selectStatsEvents` (one project) | scan + PK joins | 24-27 ms | 25-30 ms |
| strategy costs | scan + PK joins | 16-20 ms | 15-17 ms |
| context costs | scan + PK joins | 9.3-9.5 ms | 9.3 ms |
| coordinator worker costs | scan + PK joins | 16.5-17.3 ms | 19 ms |
| every other store query | index seek | < 0.2 ms | < 0.2 ms |
| `GET /api/board` (`nf serve`) | board views + telemetry + stats | 1.0-1.1 s cold, 0.68-0.75 s warm | 1.0 s cold, 0.68-0.81 s warm |

The `nf board --json-only` snapshot costs seconds because it encodes JPEG thumbnails for 131
attachments, not because of SQL; the live board serves full images over `/artifacts` and pays the
stats plan only.

### Change policy

The v10 schema is frozen. A change is a **new** migration appended to `MIGRATIONS`; an applied
migration is never edited, and no command alters the store outside `migrations.ts`.

- **Additive, the default**: a table, a nullable column or one with a constant default, an index, a
  trigger. No row is rewritten, older stores open with the new nf, and an older nf refuses the new
  store with `store_too_new` (see [Migration safety](#services-layers-and-errors)).
- **Destructive, reviewed**: dropping or renaming a column or table, changing a type, `CHECK`,
  `NOT NULL` or a unique key, and adding or removing a value of a `CHECK`. It needs a table rebuild
  migration (`CREATE x_vN ...; INSERT INTO x_vN SELECT ...; DROP TABLE x; ALTER TABLE x_vN RENAME TO x;`
  plus its indexes and triggers, as v5 does for `attempts`), the automatic pre-migration backup and a
  golden comparison. Dropping an unused index keeps every row and is additive in effect.
- **Backup first**: every store below `LATEST_VERSION` is copied with `VACUUM INTO` to
  `$NF_HOME/backups/nf-pre-v<version>-<stamp>.db` before the first migration statement, and the copy
  is named on stderr. A failed copy aborts the opening with `backup_failed`.
- **Golden comparison**: for any change beyond adding an index, copy the real store
  (`cp ~/.nf/nf.db* "$NF_HOME/"`), record `nf status --json`, `nf stats --by
  task|model|strategy|context|coordinator --json`, `nf board --json-only` and `bun test
  packages/cli/test/golden.test.ts` before and after; the outputs must be byte-identical except
  fields that are the change's point (`generatedAt`, the wall-clock `liveness` heuristic). Run
  `EXPLAIN QUERY PLAN` and interleaved timings for the stats, board and serve queries.
- **Version guard**: `LATEST_VERSION` is `MIGRATIONS.length`; `user_version` is read from offset 60
  of the SQLite header before the store is opened, so an older nf never journals a newer store and
  refuses it by name. `migrate` refuses a store that passed `LATEST_VERSION` after opening too.
  Existing v2 stores keep opening (`compat.test.ts`).
- **Adding a migration**: append `const V<n> = ...` to `migration-sql.ts` and add it to `MIGRATIONS`;
  keep one statement per line because `migrationStatements` splits on a line-final `;` (a trigger
  body keeps its mid-line `;`). Data steps run in `migrate` by target version, after the statements
  (`PREFIX_VERSION`, `COORDINATOR_VERSION`), and must be idempotent. Update `compat.test.ts`
  (`LATEST_VERSION`, `user_version`, the added and dropped schema objects) and run `bun run verify`.

## Services, layers and errors

- **Services** use `Context.Service` with the interface inline, a private `make` and an exported
  `layer` (T3 `effect-services.md`, Eskais `PostgresPersistence`). Dependencies come from the
  environment (`yield* SqlClient.SqlClient`), never constructor parameters.
- **SQL** goes through `effect/sql` `SqlClient` tagged templates only, never `unsafe` with `?`
  placeholders, so a `@effect/sql-pg` layer compiles the same statements to `$1`. The SQLite layer is
  `@effect/sql-sqlite-node` (backed by `node:sqlite`), plus our pragmas. A Postgres store is a new
  layer providing `SqlClient`; `TaskStore` and the workflows do not change.
- **Migrations** keep the exact v1/v2 SQL and `PRAGMA user_version`, so existing `~/.nf` stores open
  unchanged; v3 only adds `catalog_snapshots` and `route_blocks`, v4 the nullable
  `strategy` column on tasks and attempts, and v5 rebuilds `attempts` to admit the `direct`
  mechanism and adds `subagent_spawns` plus the nullable `usage_events.parent_attempt_id` link, and
  v7 adds the task `ui` flag and `attempt_attachments` (the artifact rows of `nf attempt attach`),
  v8 the nullable attempt `pr_url`, v9 the attempt's `coordinator_thread_id` and
  `coordinator_model` plus the `coordinator_threads` registry of extra coordinator threads per
  project (the v9 step backfills existing attempts from their coordinator threads' usage: the turn
  at or before the attempt's start, else the first turn recorded after it, because usage lands when
  a turn completes and a dispatched attempt starts before its coordinator's turn is written), and v10
  drops the four indexes no query reads. `persistence/migration-sql.ts` holds the versioned SQL and
  `persistence/migrations.ts` the runner; [Schema](#schema) reviews the result. Migrations run with
  foreign key enforcement off and a `foreign_key_check` before commit, because SQLite cannot drop
  and recreate a referenced table inside an enforcing transaction. Effect's `Migrator` is not used:
  it tracks versions in its own table, which would change the physical schema of live stores. A
  Postgres layer would run the same statements through `Migrator.fromRecord` (as Eskais does).
- **Migration safety** (`persistence/backup.persistence.ts`, `persistence/sqlite-layer.ts`). Since
  every command opens and migrates the store, an update must never be a one-way door. An existing
  store below `LATEST_VERSION` is copied with `VACUUM INTO` to
  `$NF_HOME/backups/nf-pre-v<current>-<UTC stamp>.db` before any migration statement runs, and the
  path is printed on stderr through the `notice` callback of `storeLayer` (the CLI maps it to
  stderr, tests to an array). A failed copy fails the layer with `backup_failed` and
  `...; the store was not migrated`, so no migration starts; a fresh store (no `nf.db`) is
  migrated without a copy. `nf backup` and the pre-migration copy share the snapshot and prune
  step, which keeps the newest `NF_BACKUP_KEEP` (default 10) files by the UTC stamp in their name
  and never the copy just written. A store whose `user_version` is above `LATEST_VERSION` is
  refused with `store_too_new`, naming both versions and `git pull && bun install`; the version is
  first read from offset 60 of the SQLite header, so the store is never opened, journaled or
  switched to WAL by an older nf.
- **Resources** are scoped: the store client is owned by its layer, and each read of a source database
  opens a read-only client inside `Effect.scoped` and closes it on exit. A busy source is retried with
  `Schedule` (linear backoff, 3 retries). Liveness (`sources/t3-liveness.ts`) reads T3's
  `orchestration_v2_projection_*` rows the same way: threads and runs are required, the activity,
  request and error projections are optional, and `nf status`/`nf board` degrade to unknown liveness
  when the source is missing or unreadable. The same read resolves a delegated attempt to its
  thread, so the coordinator never has to hand the thread id back: T3 derives the thread id from
  the client request id (`thread:delegated-task:<command id>:delegate-task:<client request id>`),
  which is matched on the decoded suffix, never as a substring, preferring an undeleted thread;
  when T3 generated that id itself, the `orchestration_v2_projection_subagents` row T3 recorded
  under the attempt's own coordinator thread carries the child thread and the brief, whose attempt
  key binds it. A follow-up send is resolved the same way: T3 keeps the command's client request
  id in the message id it projects (`message:<source>:<command>:thread-send:<client request id>`)
  and in that message's run, so a `thread_send_reuse` attempt is judged by its own run and its
  thread, when absent, comes from the same message; without one, only runs requested after the
  attempt started count. A follow-up sent in queue mode is mapped by T3 to the run active at send
  time, and NF follows that mapping. The brief fallback counts distinct child conversations:
  several sends into one conversation name it once. Two candidates stay unbound rather than
  binding the wrong thread, and a dispatch with no thread past `stallMinutes` from its start is
  `missing` again. Each verdict also has a person-readable reason, which the board view carries
  for the card.
- **Errors** are `Schema.TaggedError` in the error channel; `throw` is for defects (Eskais, T3).
  `NfError { code, message }` covers every rejected operation: the CLI prints the message and exits 1,
  so one class with a code keeps behavior identical. `SqlError` stays typed and prints as an internal
  error. The CLI's `UsageError` exits 2.
- **Functions** use `Effect.fn("Module.operation")`; `Effect.fnUntraced` for per-row helpers (T3,
  Effect `LLMS.md`). `runPromise` appears only at the CLI boundary and in tests.
- **Schema at boundaries**: argv JSON flags, `tasks.json`, T3 rows and `payload_json`, Pi entries and
  the price file and the cached OpenRouter catalog are decoded with Schema. A malformed record is
  skipped and counted in the sync warnings, and a malformed token field is unknown (`NULL`), never
  zero. Prices go through one chain in `sources/prices.ts`: LiteLLM, then OpenRouter's public
  catalog (`sources/openrouter-prices.ts`, cached in `$NF_HOME/openrouter-models.json` and refreshed
  weekly or by `nf sync`), then `policy.yaml`'s `prices`; every rate carries its layer, and
  `NF_OFFLINE` skips the network.

## CLI

`effect/cli` was evaluated and not adopted: it generates its own help, usage errors and exit codes,
and NF must keep every command, flag, message and exit code byte-compatible. The CLI keeps
`node:util` `parseArgs` and runs each command as an Effect; the store layer is provided only to the
commands that need it.

`nf serve` is the one long-running transport (`packages/cli/src/commands/serve.ts`). It serves the
prebuilt page and answers `GET /api/board[?project=<prefix>]` by calling `boardData`
(`packages/core/src/board/board-data.ts`) per request, `GET /api/health` so a second `nf serve`
reuses it, and `/artifacts/<id>` for the recorded attachments. It binds `127.0.0.1` only, keeps no
board data and writes nothing on a read; only the git and `gh` derivation behind a task's location
is reused between polls, for ten minutes. `serve-write.ts` adds the two writes the served page
uses, `POST /api/tasks/<KEY>/accept` and `POST /api/tasks/<KEY>/reject`, behind a random token it
embeds in the page, the page's own Origin/Host, a JSON content type and a 16 KiB body: accept runs
`TaskStore.acceptTask` exactly as `nf task accept --approved-by-user` does and reject runs
`TaskStore.rejectReview`, which moves the task to `working` with the comment as `decision_needed`
and records a `review_rejected` event; both belong to `user`. Refusals keep the gate's message and
answer 409. The page posts with that token and refetches the board with TanStack Query, while a
snapshot embeds the same `boardData` payload as `initialData` and never refetches.

`serve-git.ts` adds the read-only git API for the board's Git tab and task dialog, all `GET`:
`/api/git/repos?project=`, `/api/git/branches`, `/api/git/log` (`branch`, `all`, `cursor`, `limit`),
`/api/git/commit?sha=`, `/api/git/compare?base=&head=`, `/api/git/worktree` (or `?task=<KEY>`) and
`/api/tasks/<KEY>/branch`; every git route but the last takes `project` and `repo`. The workspace is
the T3 project (`projection_projects.workspace_root` in `statev2.sqlite`) rooted at the NF project's
checkout or the closest one containing it, else the checkout itself; `repos` scans it four levels deep
for nested repositories (skipping dot folders, `node_modules`, `dist` and the like), and `repo` is a
path relative to it that must stay inside it after resolving links and be a checkout's top level
(`403 repo_outside_workspace` otherwise), and so must its git common dir, so a `.git` file cannot
point a folder at another repository. A task's worktree may live elsewhere when its repository is
inside. A branch can be named like an option (`refs/heads/--output=x`), so a ref name reaches git
only in `rev-parse --verify --end-of-options`; every other command gets the resolved sha.
`packages/core/src/git` runs git with `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, no
fsmonitor, external diff or textconv, never fetches, and validates each response with the Schemas
of `@nf/contracts` `git.ts`; counts git cannot give are `null`. Patches stop at a file boundary at
2 MiB or 300 files (`GIT_PATCH_LIMITS`) with `truncated: true`; a merge is shown against its first
parent, and a task commit is `pushed` when its upstream has it, or, without an upstream, when any
remote-tracking ref does.

`nf t3 init` (`packages/cli/src/commands/t3.ts`) registers that server for T3 Code by merging the
`Board` script into the project checkout's `t3.json`; the merge, its validation against T3's file
schema and the write live in `packages/core/src/system/t3-project-file.ts`. The port default is
`serve.ts`'s and both commands share it.

## Lint and tests

- Oxlint through `effect-tsgo oxlint --type-aware --deny-warnings`, with the presets of
  `@p-otero/oxlint-rules` (pinned by commit SHA) on top of `@effect/tsgo`'s recommended rules:
  floating effects, missing `return yield*`, leaking requirements, the shared comment and
  component rules. Versions match Eskais (`@effect/tsgo` 0.67.5, `oxlint` 1.92.0,
  `oxlint-tsgolint` 7.0.2006); oxlint stays below 1.93 because `@effect/tsgo` supports up to 1.92.
  [`docs/lint.md`](lint.md) lists the presets per scope and the rules relaxed for tests.
- ast-grep is not adopted: Eskais' rules encode its own entity/CRUD architecture, which NF has not
  joined yet.
- Tests run on `bun test` with `Effect.runPromise` (a `ManagedRuntime` over the store layer per
  fixture). `@effect/vitest` 4.1.2 was tried and fails under `bun test` (`V.TestRunner.getCurrentSuite`
  is undefined), so it is not used. The CLI smoke and golden tests run the real `nf` under Node; the
  golden outputs and the v2 store fixture were recorded from the previous implementation.

## Agent guidance

Coding rules for agents are in [`AGENTS.md`](../AGENTS.md). For Effect itself, agents should read
the Effect repo's `LLMS.md` and `ai-docs/` (also vendored in T3 at `.repos/effect`) rather than older
Effect 2/3 material.
