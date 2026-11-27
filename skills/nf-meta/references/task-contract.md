# Tasks and attempts

## Store

Task keys are `<PREFIX>-001` and attempt keys `<PREFIX>-001-A1`, where the prefix is the project's (for example `NF-001`, `NF-001-A1`). `nf project set --prefix XYZ` changes the current project's prefix and re-keys its tasks and attempts.

Reuse an authorized existing tracker if the project has one; keep only missing execution references locally. Otherwise, when `nf` is on PATH, it is the store (SQLite in `$NF_HOME`, default `~/.nf`). Only the coordinator writes tasks and attempts, and only through `nf`: never read or edit the database or `.nf/tasks.json`. Add `--json` to read. `nf` rejects illegal transitions, a second live writing attempt, cycles and `done` without every acceptance item passing. A command that migrates a store below its latest schema first copies it with `VACUUM INTO` to `$NF_HOME/backups/nf-pre-v<version>-<stamp>.db`; never edit or restore the store while an `nf` command runs.

- Tasks: `nf task add --title --goal --acceptance (repeat) [--depends-on NF-001] [--profile] [--strategy s] [--status proposed|todo] [--ui]`; `list`, `show`, `next`, `approve`; `set NF-001 --status s [--reason] [--blocker JSON]`; `check NF-001 --item n --result pass|fail|unverified --evidence`; `accept [--approved-by-user]`; `reject --comment`; `intervene --note`; `depend --on`.
- Attempts: `nf attempt start NF-001 --kind --mechanism --provider --model --profile --strategy --reason` prints the attempt key and its client request id before dispatch; `update` (`--status active`, thread/task IDs, worktree, branch, `--add-commit`) and `finish --status succeeded|failed|cancelled|superseded`; `show A --reports --attachments`; `attach A --file path --theme light|dark --name screen`; `reconcile` judges each live attempt from T3's state (read-only; `--apply` records a missing thread as `unknown` and a finished failure as `failed`, never the task); `nf status` lists live attempts with liveness and ready tasks.
- Workers append `nf attempt report <attempt> --kind checkpoint|result`; it never changes task state. `nf import` loads an existing `.nf/tasks.json` once.

Without `nf`, use `.nf/tasks.json` in the durable primary checkout, never a disposable worktree; workers report only in their final message. Keep `.nf/` untracked: if `git ls-files -- .nf` lists files, stop and ask; otherwise append `/.nf/` to the repository's `info/exclude` under the Git directory if missing and confirm `git check-ignore .nf/tasks.json` before writing. Never edit the shared `.gitignore` or commit state. Write valid UTF-8 JSON, preserve unrelated records, rewrite the whole document and re-read it to validate.

Times are ISO 8601 UTC. Record only real host IDs; unknown values stay `null`.

```json
{
  "schema_version": 2,
  "coordinator": { "environment_id": null, "thread_id": null, "thread_link": null },
  "tasks": []
}
```

A `schema_version: 1` file is upgraded in place by adding missing fields as `null`; never drop existing data.

## Task

- `id` (`NF-001`, never renumbered), `title`, `goal`, `acceptance` (list of observable checks).
- `status`: `proposed`, `todo`, `working`, `review`, `blocked`, `done`, `cancelled`.
- `depends_on` (task IDs, no cycles), `authorization` (allowed work and exclusions).
- `profile`, `analysis_mode` (`review` | `autonomous`) when relevant.
- `strategy` (`direct`, `plan`, `cheap`, `review`, `auto` or none; attempts inherit).
- `attempts`, `evidence` (exact checks, results, commits).
- `accepted_first_pass`: true only if the first implementation attempt was accepted without repair.
- `human_interventions`: count of user corrections, manual edits or decisions needed to finish it.
- Optional: `source`, `design_ref`, `decision_needed`, `blocker` (stable identity, failing acceptance, consecutive no-progress cycles, tried hypotheses, last verified state, checkpoint, escalation used), `superseded_by`.

A `todo` task is ready when dependencies are `done`, decisions resolved and no attempt may still own it. Ready is derived, never stored.

Transitions: `proposed` → `todo` on user approval (or in autonomous mode); `todo` → `working` when a writing attempt starts; `working` → `review` when a succeeded writing attempt ends, or `blocked` with a concrete condition; `review` → `done` only with verified acceptance and integration evidence, or back to `working` for a repair (the rejection comment stays as `decision_needed`); `blocked` → `todo` once resolved and reconciled; anything unfinished → `cancelled` after stopping its work. Reopen `done`/`cancelled` only on explicit request.

## Attempt

At most one active writing attempt per task. Record before dispatch, complete after:

- `id` (`NF-001-A1`), `kind` (implementation, integration, research, design, review), `status` (dispatching, active, succeeded, failed, cancelled, superseded, unknown).
- `mechanism`: `delegate_task`, `t3_thread_launch`, `thread_send_reuse`, `fork` or `direct`.
- `environment_id`, `thread_id`, `thread_link`, `task_id` (T3 delegated task ID), `client_request_id`.
- `provider_instance_id`, `model`, `options` as requested; `executed_model` when T3 reports a different one.
- `profile`, `reason` (one line: why this model, why delegate), `fallbacks` (routes tried before, each with the failure reason and reset if known).
- `context_mode` (`fresh`, `fork`, `reuse`, `compact`) and `source_thread_id` for fork/reuse.
- `repair_of` (attempt ID) for repairs.
- `started_at`, `ended_at`; `base_commit`, `worktree`, `branch`, `commits` or a recoverable diff location.
- `outcome`, `failure` (class + evidence), `retry_at` (host reset), `last_verified`, `remaining`.

Never store tokens, credentials, transcripts, tool logs or invented quota estimates. Token usage and cost are derived later from T3 and provider logs through `thread_id`; do not copy them here.

## Result contract

Workers end with:

```text
TASK: NF-001
ATTEMPT: NF-001-A1
RESULT: SUCCEEDED | BLOCKED | FAILED
OUTCOME: <observable result>
WORKTREE / BRANCH: <path and branch, or n/a>
COMMITS / DIFF: <SHAs or recoverable diff location>
CHECKS: <exact command -> PASS | FAIL | NOT RUN + reason>
REMAINING: <unfinished work and checkpoint, or none>
RISKS: <residual risks or needed decision, or none>
```

A blocked result adds `BLOCKER` (`reasoning_stalled`, `environment`, `decision_needed` or a specific cause), `TRIED`, `LAST_VERIFIED`, `CHECKPOINT` and `NEEDS`.

Discussion threads (review mode) end with a single message sent to the coordinator:

```text
NF-RESULT <topic>
decision: <one line>
tasks:
  - title: <title>
    goal: <observable outcome>
    acceptance: [<verifiable check>, ...]
    depends_on: [<task id or title>]
    profile: bounded | reasoning | lookup
END
```

Match late results to their attempt; a superseded result never closes or reopens work automatically.
