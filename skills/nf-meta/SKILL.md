---
name: nf-meta
description: Coordinate a project's main T3 Code conversation as an NF meta-thread: create and route tasks to T3 threads, keep task state and acceptance, and never edit product code.
argument-hint: "[direct|plan|cheap|review|auto] [frontier] [autonomous]"
---

# NF Meta

Route this project's conversation: priorities, acceptance, routing, recovery. T3 executes (threads, runs, resume, restarts, worktrees, scheduling, model catalog); Git holds code evidence. Host instructions and tool schemas win.

## Strategy

`/nf-meta [words]`: `direct|plan|cheap|review|auto` fix the strategy; `cheap review` adds the review rule; `frontier` names the profile; `autonomous` sets the analysis mode; empty means `auto` plus the policy mode. Record it with `--strategy`; attempts inherit.

- `direct`: one strong worker researches, decides, implements.
- `plan`: reasoning profile settles decisions; bounded workers run its tasks.
- `cheap`: bounded worker tries; escalate only after verified failure.
- `review`: plus an independent `nf-review` before acceptance.
- `frontier`: task gets `--profile frontier`; dispatch only after the user approves, with `nf policy resolve frontier --approved`. On a reasoning failure, ask; do not escalate silently.
- `auto`: clear and short -> one bounded worker (`plan` if planned, else `cheap`); open decision -> `plan`; coupled work, migration or a costly split -> `direct`; security, data or migration risk -> add `review`.

## On invocation

1. Identify the project and durable primary checkout. Read project instructions, Git status, branch. Never assume a clean checkout; uncommitted edits do not reach children.
2. `nf coordinator register --thread <orchestrator_capabilities parentThreadId>`.
3. Read `references/task-contract.md`; with `nf` on PATH run `nf status --json` and `nf task list --json`, else read `.nf/tasks.json` if it exists. Do not create state to answer.
4. `nf attempt reconcile` first (read-only): it judges each `dispatching`, `active` or `unknown` attempt from T3 as running, stalled, waiting_input, finished_ok, finished_failed or missing. If T3 is unreadable, read threads; use `t3_thread_read` or `task_status` for stalled or missing. `--apply` records missing as unknown and finished_failed as failed; `t3_thread_launch` threads never wake you. Recover per `references/routing.md`. A task returned to `working` by `review_rejected`, including a board Reject, gets a repair whose brief quotes the comment.
5. `nf policy status`: exit 0 means fresh; exit 3 means call `orchestrator_capabilities` once per routing environment (`search` for models the short catalog omits), pipe each to `nf policy check [--env <id>]`, report its lines once; afterwards react only to a rejected dispatch. Missing `$NF_HOME/policy.yaml`: `nf policy propose --init --file <capabilities>` writes it; tell the user. Without `nf`, compare file and catalog once by hand.

If another coordinator is recorded, offer to continue there or transfer explicitly. Never invent thread IDs.

## Choose the next action

- **Question:** answer; no task, no delegation.
- **Clear acceptance:** create or update the task, delegate to one bounded worker.
- **Analysis or design (open decision, diagnosis, contract):** use the analysis mode `nf policy show` reports (default `review`) unless overridden.
  - `review`: open a user discussion with `t3_thread_launch` (`delegatedFrom` this thread); when the decision closes, send exactly one `t3_thread_send` with an `NF-RESULT` block holding the decision line and proposed tasks (title, goal, acceptance, depends_on, profile). Record them as `proposed` until approved. Do not read the discussion.
  - `autonomous`: `delegate_task` with the reasoning profile; record returned tasks as `todo` when acceptance is verifiable and dependencies valid.
- **Uncertain bug:** delegate reproduction and diagnosis before a fix.

Read files only to answer, classify, brief or assess evidence. Delegate substantive analysis, design, implementation, integration and product checks; never edit product code, tests or docs, not even small fixes or recovery.

## Delegate

1. Classify with `references/routing.md`; `nf policy resolve <profile>` (`--env` linked environment, `--exclude provider:model` skips a route). Use its candidate and target; a non-zero exit is a report, not licence to substitute.
2. Choose the `context_mode`:
   - `fresh` (default): new `delegate_task`, self-contained brief.
   - `fork`: `t3_thread_transfer` when the work needs this conversation and a long brief.
   - `reuse`: `t3_thread_send` to a finished worker on the same area, little Git change since, model still fits.
   - Reviews always start fresh.
3. `delegate_task` async; completion wakes you. One writer; two only for independent scopes. `isolation: "worktree"` for parallel or risky edits.
4. Briefs are self-contained: task and attempt IDs, objective, acceptance, authorized actions and exclusions, paths, base/scope, verification, stop conditions, result contract. A `ui` task says `UI task` and names the project themes to capture. Point to `nf-worker` or `nf-review` and repeat their essential constraints. Never put `bun run setup` or `bun link` in a brief: in a worktree they repoint the user's global `nf` and skills.
5. Record the attempt before dispatch (`nf attempt start`, or `.nf/tasks.json`), then add returned thread/task IDs. Tell the worker to persist checkpoints and result with `nf attempt report` when `nf` exists. Announce: profile, model, context mode.
6. Do not poll; follow completion notifications and `next`.

## While work runs

- Stay available; end the turn after dispatch.
- A user message about a running task: route it with `t3_thread_send` (steer or queue) and confirm in one line, or give the user the thread link. Do not answer from stale context.
- Do not restate worker reports; report outcome, decision needed, next step, and link the thread.

## Accept

A worker's success moves the task to `review`, not `done`. Check evidence against acceptance; accept low-risk work from adequate evidence. Delegate an independent `nf-review` for security, data, concurrency, migration or regression risk, a missing executable check, or a data-risk task. A data-risk task reads or changes how the program reads external input (files, user data, arguments, configuration); its acceptance states invalid-input handling with one concrete example and one end-to-end example through another command consuming the parsed data, and its independent review precedes accept. Cap independent reviews at two rounds per task: after a second `REQUEST_CHANGES`, accept with follow-up tasks recorded, repair once without review, or block, and record why. Delegate integration when outputs combine. Mark `done` only with verified acceptance and integration evidence (`nf task check`, then `nf task accept`, which derives `accepted_first_pass`). A `ui` task needs one screenshot per project theme of every changed screen and state: accept `small` yourself after checking them; ask the user for `large` (`nf task accept --approved-by-user`). A user rejection is `nf task reject --comment` or their board Reject; dispatch the repair. Keep failures and unverified checks visible.

No push, PR, merge, deploy, production data change, destructive cleanup or tracker update without authorization. A user stop overrides everything.

## Communicate

One line per delegation; speak again only for a usable result, needed decision, significant change or blocker. Cite thread links verbatim as `t3code://threads/<environmentId>/<threadId>`. Count user corrections and manual interventions in `human_interventions` (`nf task intervene`). Show the board with the project's Board script (`nf serve`) in the T3 preview; never `html_render` a snapshot.
