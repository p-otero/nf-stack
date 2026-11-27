# Lint

`bun run lint` runs `effect-tsgo oxlint --type-aware --deny-warnings packages`. Every warning fails
the build, so a rule is either satisfied or turned off here with its reason.

## Rules

[`@p-otero/oxlint-rules`](https://github.com/p-otero/oxlint-rules) supplies the shared presets,
pinned to a commit SHA in the root `package.json`. The root `.oxlintrc.json` layers them:

| Preset              | Adds                                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `base.json`         | built-in plugins, categories, `max-lines` 400, `p-otero` comment rules  |
| `effect.json`       | `@effect/tsgo` recommended plus the `p-otero` Effect rules              |
| `react.json`        | React hook, purity, React Compiler and component-size rules             |
| `react-agents.json` | the `p-otero` `useEffect` heuristics for agent-written product code     |

The React layers are extended at the root, not in a `packages/board/src/**` override, because
oxlint rejects `extends` inside `overrides` (`unknown field \`extends\``). They stay inert outside
the board: no other package imports React, and the `p-otero` component rules match `\.tsx$` only.
`react-agents.json` is on because NF worker agents write the board, which is the codebase its Effect
heuristics target. It keeps the default `**/hooks/**` allow glob for
`p-otero/no-effect-outside-hooks`, so an Effect that really syncs an external system belongs in a
board hook file rather than a component.

`options.typeAware` stays in the root file because oxlint reads that option from the root only, and
the Effect rules run through `effect-tsgo oxlint`, which provides the `effecttsgo` plugin. The React
preset runs `react/no-unstable-nested-components` with `allowAsProps: true`, so a data-table
`cell: (row) => ...` render callback is not a component; a nested component definition still fails.

Generated Eskais registry code (`packages/board/src/components/ui`, `packages/board/src/lib`) is not
linted, so its Effects never reach `p-otero/no-effect-outside-hooks`; it is installed from the pinned
registry commit.

## Relaxed rules and why

The test override (`packages/*/test/**`) relaxes three rules:

- `typescript/no-unsafe-type-assertion`: tests read `JSON.parse` output and fixture rows, where a cast
  states the shape under test; production code narrows instead.
- `no-await-in-loop`: a test drives one store call or fixture at a time, and the SQLite writes it
  asserts on must stay ordered.
- `max-lines`: a suite keeps its fixtures and its cases together, so splitting it would only scatter
  the setup the cases share.
