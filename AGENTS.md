# NF-Stack: agent instructions

Read [`README.md`](README.md) for what NF is and [`docs/architecture.md`](docs/architecture.md) for
the package layout and Effect conventions.

## Working rules

- Bun for tooling (`bun install`, `bun test`, `bun fmt`, `bun check`); Node 24 runs `nf` from the
  TypeScript sources. Before handing off, run `bun run verify`.
- Tests always use a temporary `NF_HOME`. Never write to the real `~/.nf`, `~/.t3`, `~/.pi` or global
  config; T3 and Pi data is read-only.
- Commits: one logical change each, authored by the repository identity. Don't push, open PRs or
  merge without explicit approval.

## Agent skills

The board's UI skills are installed files under `.agents/skills`: `eskais-ui`, `eskais-perf` and
`eskais-mockup` from the Eskais UI tag the registry pins (v0.2.19), and UI SDK's `ui-sdk` from the
version in `node_modules`; `skills-lock.json` records both. `skills add` also writes
`.claude/skills`, which holds absolute symlinks and stays uncommitted. Refresh them after a re-pin,
with Vercel's skills CLI pinned and telemetry off:

```sh
DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx skills@1.8.1 add p-otero/eskais-ui@<tag> --full-depth --skill eskais-ui --skill eskais-perf --skill eskais-mockup -a universal -a claude-code -y
DISABLE_TELEMETRY=1 DO_NOT_TRACK=1 npx skills@1.8.1 add ./packages/board/node_modules/@ui-sdk/core/skills/ui-sdk -a universal -a claude-code -y
```

The repository's own `skills/nf-*` are separate and linked with `nf skills link`.

## TypeScript and Node

- Erasable syntax only (no enums, namespaces, parameter properties) and `.ts` import extensions, so
  Node can strip types. No Bun-only APIs outside tests.
- Statuses, kinds and other semantic values come from the `as const` objects and arrays in
  `@nf/contracts`; types derive from them.
- Keep every `effect`/`@effect/*` package on the same exact version as Eskais.

## Effect

- Import modules as namespaces: `import * as Effect from "effect/Effect"`.
- Services: `Context.Service` with the interface inline, private `make`, exported `layer`.
  Dependencies are yielded from the environment, not passed to `make`.
- Reusable effects use `Effect.fn("Module.operation")`; `Effect.fnUntraced` for per-row helpers.
- Expected failures are `Schema.TaggedError`s in the error channel (`NfError` for rejected
  operations). `throw` is for defects. Always `return yield*` a failure.
- `Effect.runPromise` only at the CLI boundary and in tests.
- Validate every external input with Schema (argv JSON, `tasks.json`, T3 rows and payloads, Pi
  entries, price file). Unknown numbers stay `null`, never `0`.
- SQL on the NF store only in `packages/core/src/persistence`, through `SqlClient` tagged
  templates (no `unsafe` with `?`), so a Postgres layer can replace SQLite. Reads of T3's database
  live in `packages/core/src/sources` and stay read-only. Never change the physical schema without a
  new migration; existing `user_version` 2 stores must keep opening (`compat.test.ts`).
- Lint enforces the shared `@p-otero/oxlint-rules` presets and the Effect Language Service
  rules; warnings fail (`bun run lint`, see [`docs/lint.md`](docs/lint.md)).

## Code quality

- Comments only for non-obvious constraints. No helper dumping grounds, no abstraction without a
  second real use.
- Preserve CLI output byte-for-byte unless the change is the point; `packages/cli/test/golden.test.ts`
  replays the read commands against outputs recorded from the previous implementation.
