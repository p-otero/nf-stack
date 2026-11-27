---
name: nf-autoconfigure
description: Propose an NF routing policy from the models this machine's T3 catalog offers, show the reviewable diff, and write it only after the user approves. Use after installing NF, when the catalog changes or when `nf policy status` reports missing routes.
---

# NF Autoconfigure

User-invoked. NF computes the policy; never edit `$NF_HOME/policy.yaml` or its proposal by hand.

1. Call `orchestrator_capabilities` (repeat with `search` while a policy model is missing). Pipe
   each result to `nf policy propose --json`, or pass it with `--file`; add `--env <id>` for a
   linked environment.
2. Without `$NF_HOME/policy.yaml`, `nf policy propose --init` writes it from the catalog with the
   template's price caps and frontier profile. Report what it wrote; skip steps 3-4.
3. Show the diff unchanged: additions, reorders, removals (a provider instance this machine no
   longer offers, dropped unless pinned), unavailable routes, models a price cap kept out, the
   unclassified models and the routes it would disable. Add `--reorder` only when the user asks.
4. Stop and ask. Apply only after an explicit yes to that diff: `nf policy apply` (the saved
   proposal) or `nf policy apply --file <path>`.
5. If apply refuses because `policy.yaml` changed, propose again instead of forcing. Report the
   backup path and `nf policy status`.

Never write the policy, model traits or a proposal directly, and never apply without approval.
