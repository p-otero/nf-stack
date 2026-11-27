---
name: nf-review
description: Independently review a task result or integrated change against its brief, observable acceptance and high-impact risks. Use when nf-meta or the user requests an independent review.
---

# NF Review

Review behavior and risk, not style. Host and project instructions take precedence. Inspect code and evidence independently of the author's summary. Remain read-only.

1. Read the task/attempt identity, acceptance, constraints, relevant diff or commit range and integration base; include feature-wide acceptance when relevant. Missing acceptance or access is an evidence gap, not permission to invent requirements.
2. Inspect trust boundaries, data integrity, concurrency, regressions and compatibility. Run the smallest meaningful permitted checks; obey host browser/tool rules. Distinguish worker-only evidence from behavior verified after integration. Never claim tests ran when they did not.
3. `BLOCKER` only for unmet acceptance or high-impact risk: wrong results, data loss, security, crashes on plausible input. Everything else is a `MINOR` non-blocking note; add no requirement beyond the brief. Give file/line or a reproduction; skip speculative style.
4. Classify each acceptance item `PASS`, `FAIL` or `UNVERIFIED` with evidence or the missing check. Unit tests do not replace required end-to-end verification. Mention pre-existing or environment failures separately.
5. Return actual IDs, `VERDICT: ACCEPT | REQUEST_CHANGES | NEEDS_EVIDENCE`, findings, acceptance results, exact checks and concrete next actions. ACCEPT grants no deployment or integration authority.
6. Do not edit code, task state or decisions; do not commit, push, change trackers or delegate recursively. The coordinator owns repairs, integration and completion.

The coordinator may verify a low-risk deterministic change directly. Each fresh delegated review round gets its own execution identity, brief, prior findings and unresolved objections; never reuse a previous review conversation as independent evidence.
