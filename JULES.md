# JULES.md — electron-mcp

Jules (Google's async coding agent) entrypoint. Defers to
[`AGENTS.md`](./AGENTS.md) as the authoritative source.

Jules runs asynchronously in a cloud VM and produces a PR. Treat
every task as "produce one focused commit that ships cleanly,"
because you won't be there to iterate.

## Before opening a PR

1. Read `AGENTS.md` at the repo root.
2. Run `npm install && npm run typecheck && npm run lint && npm run test`.
   If any of those are red before your change, report and stop —
   don't try to fix preexisting failures alongside a feature.
3. If the task touches the tool registry, run the stdio smoke test
   too (see `docs/samples/smoke-test-2026-04-19.md` for the shape).

## Scope rules

- **One slice per PR.** Don't bundle a schema change with an
  unrelated refactor. Reviewers need to reason about one
  semantically-cohesive change.
- **Tests before code** when feasible. Every new behaviour that
  lives in pure-logic code gets a `vitest` case under `tests/`.
- **Adapter changes ship with a smoke-test note.** The adapter
  talks to Playwright — unit-testing it in isolation invariably
  drifts from reality. If you changed a method on
  `ElectronAdapter`, include in the PR body the JSON-RPC frame
  sequence you used to validate the behaviour against a real
  Electron binary (or explicitly note that you couldn't and need
  the reviewer to run it).

## Commit + PR style

- No AI provenance. The commit message describes the change —
  nothing about who wrote it.
- `feat: …`, `fix: …`, `docs: …`, `chore(deps): …`, `test: …`,
  `style: …`, `refactor: …` — prefixes follow the existing log.
- PR body should include: summary, test plan, error-envelope
  impact (does the change add/rename/remove a stable `error.code`?).
