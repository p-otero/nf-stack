# Routing and recovery

## Classify the dispatch unit

Classify the question, not the feature, by uncertainty, coupling, impact and verification (not size or role name):

- **bounded:** acceptance is clear, the pattern is known, impact is limited, checks are concrete. Settled security or data work is bounded.
- **reasoning:** a decision or diagnosis is open, or a contract is still being defined. It returns decisions plus implementable tasks and stops; re-classify each returned task from scratch (normally bounded). It may implement only when splitting would cost more than it saves; record why.
- **lookup:** locate code, extract facts or summarize sources without a hard decision.
- **review:** independent verification justified by risk or an evidence gap; prefer a model different from the implementer's.

Escalate bounded or lookup work to reasoning only after a concrete uncertainty or demonstrated reasoning failure; missing tools, broken services, quota and failing tests alone do not prove the model insufficient.

## Pick a destination

Run `nf policy resolve <profile>` (`--env` for a linked environment, `--exclude provider:model`). It returns the first eligible candidate — cached catalog, not `disabled`, not blocked, within the profile's price caps, options valid — and its `delegate_task` target. Use only catalog-listed options; raise effort only for a concrete reasoning difficulty, never past `max_options`. Report a requested but unavailable target; never substitute. Record `profile`, the candidate and a one-line `reason`; a non-zero exit is the answer, so report its per-candidate reasons, including an over-cap price.

`frontier` is never chosen automatically: it needs the user's explicit request, and `nf policy resolve frontier` refuses until the user approves that dispatch with `--approved`.

A route is the exact provider instance + model ID. Different prefixes are different routes even when names match; never assume two routes share a quota or account without evidence.

## Recovery

T3 restarts runs, resumes native sessions (Pi included), keeps queued messages and owns retries; do not build competing retries or polling. On a failed or dead attempt:

1. **Classify** from the host error: quota/usage limit, throttling (429), auth/permission, environment, code/verification failure, context exhaustion, crash, cancellation.
2. **Reconcile** before acting: is the run still active, waiting on a question, or recoverable natively? Never start a second writer for the same task; `task_cancel` the old delegate before replacing it.
3. **Act by class:**
   - **Quota with a reported reset on Pi** (T3 does not auto-resume Pi yet): `nf route block --provider <p> --model <m> --reason quota --reset-at <ISO> --evidence "<error>"`, then `schedule_task` the resume at that reset (standing authorization in `policy.yaml`). Other routes may continue.
   - **Quota without reset, or the user wants it done now:** block the route (`--reason quota`), dispatch the next candidate from `nf policy resolve <profile> --exclude <provider:model>` and record it with `nf attempt update <ATTEMPT> --add-fallback '{"route":"provider:model","failure":"quota"}'`. Never repeat a blocked route in the same period. If none is left, ask for a named alternative or a wait, with a recommendation.
   - **Auth/permission:** block the route (`--reason auth`, no reset) and ask the user. Never widen permissions.
   - **Code or verification failure:** delegate one focused repair (`repair_of` = failed attempt). After `max_repair_cycles` consecutive cycles without verified progress, the worker returns `BLOCKED`. A `reasoning_stalled` blocker allows `reasoning_escalations` diagnostic escalation to the reasoning profile, then one implementation of its solution. If the same acceptance still fails, stop and ask the user.
   - **Environment/dependency:** delegate an authorized prerequisite fix or report the blocker; do not switch models.
   - **Context exhaustion:** continue with a fresh attempt carrying a compact brief of decisions, evidence and remaining work.
4. **Continue only the remainder** in a new attempt with a new ID, carrying commits/diff location, last verified result and blocker history. Quota-only interruptions do not consume repair or escalation budgets; renaming a blocker does not reset them.

Never replace a worker with coordinator execution, weaken acceptance or skip required checks to get past a blocker.
