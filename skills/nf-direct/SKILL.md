---
name: nf-direct
description: Implement the current task in this T3 thread while NF records the task and attempt. Use when the user wants the thread itself to do the work, with no nf-meta coordinator.
---

# NF Direct

NF records task and attempt usage, delegation and acceptance.

## Start

1. Reuse the task the user names. Otherwise create one:
   `nf task add --title "..." --goal "..." --acceptance "..."` (repeat `--acceptance`).
2. Read this thread's T3 id from `orchestrator_capabilities` (`parentThreadId`).
3. Record the attempt with the current provider and model:
   `nf attempt start <task> --kind implementation --mechanism direct --strategy direct --provider <provider> --model <model>`
4. Attach the thread and mark it live:
   `nf attempt update <attempt> --status active --thread-id <parentThreadId>`

## While working

Implement directly in this thread. For complex work, run nf-direct on a frontier model in T3.
Subagents are allowed; do not register them by hand. `nf sync` reads every spawn from T3 and
attributes it to this attempt, so counts and usage stay measurable.

## Finish

1. Verify every acceptance item against observable evidence.
2. `nf task check <task> --item N --result pass|fail --evidence "..."`
3. `nf attempt finish <attempt> --status succeeded|failed --outcome "..."`
4. `nf task accept <task>` only when every item passes. A `ui` task needs one screenshot per
   project theme of every changed screen and state (`nf attempt attach`); `large` also needs
   `--approved-by-user`. Otherwise leave the task in review and record the failures with
   `nf task check` and the attempt outcome.
