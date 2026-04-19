# GEMINI.md — electron-mcp

Gemini CLI entrypoint. Defers to [`AGENTS.md`](./AGENTS.md) as the
authoritative source; this file calls out Gemini-specific
conventions only.

## Before any task

1. Read `AGENTS.md` at the repo root (full rules, stack, layout,
   recipes).
2. Read `README.md` if you need the user-facing framing.
3. If the task touches `src/schemas/index.ts` or the tool registry,
   plan the change end-to-end (schema → handler → registry → docs
   → example → test) **before** editing — the pieces are cheap
   individually but expensive when they drift.

## Non-negotiables (quick recap — details in AGENTS.md)

- **Zod 4 only.** `z.record(k, v)`, `.issues` (not `.errors`),
  `z.toJSONSchema(schema, { target: 'draft-7' })`.
- **stdout is MCP JSON-RPC only.** Logs go to stderr via the
  logger.
- **Lower-level `Server`, not `McpServer`.** Registry is plain
  data; dispatch normalizes errors.
- **Pinned exact deps, no `^`/`~`.** Prefer the latest stable.
- **One adapter.** Only `src/electron/electron-adapter.ts` may
  import `playwright`.

## Tool usage

- Run `npm install` once after a clone or a dep bump.
- Run `npm run typecheck && npm run lint && npm run test` before
  declaring work done.
- For UI-layer verification the answer is the stdio smoke test —
  spawn `dist/server/index.js` and exchange JSON-RPC frames. The
  sample script at `docs/samples/smoke-test-2026-04-19.md`
  illustrates the call pattern and expected envelopes.
