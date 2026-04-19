# AGENTS.md — electron-mcp

Agent instructions for any AI coding tool (Claude Code, Cursor,
Codex, Copilot, Gemini, Jules) working in this repo. See `README.md`
for the user-facing overview.

## What this repo is

MCP server that exposes **Electron automation** to AI agents via
Playwright's `_electron` driver. Agents call tools like
`electron_launch`, `electron_click`, `electron_screenshot` over
JSON-RPC and drive a real Electron application: launch it, inspect
its windows, interact with the DOM, evaluate JS, capture
screenshots, kill it.

The server stands alone — it does **not** depend on `@nova/*` or any
sibling workspace. It is pure-Node, stdio-only today, and designed
to be dropped into any MCP client.

## Tech stack

- **Runtime**: Node 20+ (Bun 1.3+ also supported).
- **Language**: TypeScript 6.x, NodeNext ESM, `.js` import
  specifiers on TS paths.
- **MCP SDK**: `@modelcontextprotocol/sdk` 1.29+, **lower-level
  `Server` class** (not `McpServer`).
- **Electron driver**: `playwright` 1.59+ — only `playwright._electron`,
  no browser channels.
- **Validation**: **Zod 4 only.** `z.record(k, v)` (two args),
  `ZodError.issues` (not `.errors`), `z.toJSONSchema(schema, { target: 'draft-7' })`
  for MCP advertisement. No Zod 3 idioms.
- **Tests**: Vitest 4.
- **Lint / format**: ESLint 10 flat config, Prettier 3.
- **Package manager**: npm.
- **Dependency versions**: **pinned exact** — no `^`, no `~`. When
  bumping, pick the latest stable release.

## Layout

```
src/
├── errors/              ElectronMcpError + subclasses, normalizeError.
│                        Single source of truth for structured error
│                        envelopes.
├── logging/             JSON logger to stderr. Never writes to stdout.
├── schemas/             Every tool's Zod input/output schemas. Types
│                        are derived via z.infer; JSON Schema is emitted
│                        via z.toJSONSchema in utils/zod-to-json.ts.
├── session/             SessionManager: in-memory registry, cap
│                        enforcement, close/closeAll. No Playwright
│                        imports above this level.
├── electron/            ElectronAdapter — the only module that talks
│                        to Playwright. Keeps everything else
│                        driver-agnostic.
├── tools/               Per-category handlers (lifecycle, windows,
│                        renderer, main) + buildToolRegistry().
├── server/              createElectronMcpServer wires the pieces
│                        together. index.ts is the stdio binary.
└── utils/               allowlist globs, config from env, ids,
                         withTimeout, Zod -> JSON Schema.

tests/                   Vitest suites for pure-logic modules.
docs/                    architecture, tools, session-model, security,
                         samples, plans.
examples/                MCP request samples + end-to-end workflows.
```

**Adapter boundary**: `src/electron/electron-adapter.ts` is the only
file allowed to import `playwright`. Everything upstream consumes
the adapter's narrow interface. If you find yourself reaching
through `session.app.*` outside the adapter, lift that call into a
new adapter method.

## Commands

```bash
npm install

npm run dev            # tsx watch src/server/index.ts
npm run build          # tsc -p tsconfig.build.json -> dist/
npm run start          # node dist/server/index.js
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/**/*.ts
npm run lint:fix
npm run format         # prettier --write
npm run format:check
npm run test           # vitest run (21 cases baseline)
npm run test:watch
```

All of `typecheck` + `lint` + `format:check` + `test` must be green
before declaring work done. The build must emit a working binary.

## Core concepts

| Concept            | Meaning                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| **Session**        | A running Electron app (one `ElectronApplication`) with a generated `sessionId` like `sess_…`.            |
| **Window ref**     | How a tool addresses a window: index (number), URL substring/regex, or title substring.                   |
| **Tool**           | `{ name, description, inputSchema, handler }`. Handlers are async, parse their own input, throw on error. |
| **Error envelope** | `{ ok: false, error: { code, message, details } }`. Stable `code` strings — not prose.                    |
| **Allowlist**      | Glob list from `ELECTRON_MCP_EXECUTABLE_ALLOWLIST`. Empty = no restriction. Enforced in the adapter.      |
| **Main gate**      | `ELECTRON_MCP_ALLOW_MAIN_EVALUATE` must be `true` for `electron_evaluate_main` to run.                    |

## Non-negotiables

- **stdout is reserved for MCP JSON-RPC framing.** Never
  `console.log` in runtime code. Use the logger (stderr).
- **Structured errors only.** Throw `ElectronMcpError` subclasses.
  The server's dispatcher wraps every throw into the envelope —
  don't bypass it with try/catch-and-return-string.
- **Zod is the single source of truth.** Types (`z.infer`), runtime
  validation (`.parse`), and MCP schemas (`z.toJSONSchema`) all flow
  from `src/schemas/index.ts`. Don't duplicate shapes in interfaces.
- **Lower-level `Server`, not `McpServer`.** The registry is plain
  data; dispatch is our code; every throw is normalized. Don't
  switch to `McpServer.registerTool(...)` — it makes envelope
  enforcement harder.
- **Main-process evaluation is gated.** Read the env flag in the
  **tool handler** (`electronEvaluateMain`), not in the adapter —
  so adapter tests stay independent of the gate.
- **Tool registry is a flat array.** Adding a tool means two files
  (schemas + handler) plus an append to `buildToolRegistry()`. No
  reflection, no decorators.

## Adding a new tool

1. **Define the I/O in `src/schemas/index.ts`**:

   ```ts
   export const ElectronFooInputSchema = z.object({
     sessionId: SessionIdSchema,
     bar: z.string().min(1),
   });
   export type ElectronFooInput = z.infer<typeof ElectronFooInputSchema>;

   export const ElectronFooOutputSchema = z.object({
     ok: z.literal(true),
     sessionId: SessionIdSchema,
     result: z.string(),
   });
   export type ElectronFooOutput = z.infer<typeof ElectronFooOutputSchema>;
   ```

2. **Write the handler** in the relevant category file under
   `src/tools/` (`lifecycle.ts`, `windows.ts`, `renderer.ts`,
   `main.ts`, or a new file for a genuinely new category):

   ```ts
   export const electronFoo: ToolHandler<ElectronFooInput, ElectronFooOutput> = async (
     rawInput,
     ctx,
   ) => {
     const input = ElectronFooInputSchema.parse(rawInput);
     const session = ctx.sessions.get(input.sessionId);
     const result = await ctx.adapter.doFoo(session.app, input.bar);
     return ElectronFooOutputSchema.parse({
       ok: true,
       sessionId: session.id,
       result,
     });
   };
   ```

3. **Append to `buildToolRegistry()` in `src/tools/index.ts`**:

   ```ts
   {
     name: 'electron_foo',
     description: 'One clear sentence.',
     inputSchema: zodToJsonSchema(ElectronFooInputSchema),
     handler: electronFoo as unknown as ToolHandler<unknown, unknown>,
   },
   ```

4. **If the tool needs a new Playwright capability**, add a method
   to `ElectronAdapter`. Keep it narrow — one thing per method,
   timeout-aware (use `withTimeout`), throws adapter-level errors
   (`SelectorError`, `TimeoutError`, etc.).

5. **Document it** in `docs/tools.md` with schema + example + every
   `error.code` it can emit.

6. **Add a sample MCP frame** under `examples/requests/NN-foo.json`
   and list it in `examples/README.md`.

7. **Test it.** Pure-logic bits go under `tests/`. Adapter
   interactions get exercised by the stdio smoke test rather than
   mocked.

## Adding a new error code

1. Subclass `ElectronMcpError` in `src/errors/index.ts` with a
   stable `code: string` and a `toJSON()` that fills `details`.
2. Add the code to the table in `docs/tools.md` and the README.
3. Update `normalizeError` if you want a specific `Error` message
   pattern to map to the new code.
4. Export from `src/errors/index.ts` — everything else imports
   from there.

Stable codes today: `validation_error`, `launch_error`,
`session_not_found`, `window_not_found`, `selector_error`,
`timeout`, `evaluation_error`, `permission_denied`,
`internal_error`.

## Testing

- **Vitest** under `tests/`. One file per pure module.
- **No mocks for the DB / network / filesystem equivalents.** For
  this repo that means **no mocks of `ElectronApplication`**.
  Adapter coverage comes from the stdio smoke test against a real
  Electron binary (e.g. `electron/electron-quick-start`).
- Unit tests cover: allowlist globs, error serialization, session
  manager cap enforcement, schema defaults + rejections.
- Fake objects for `SessionManager` tests are fine — they stand in
  for `ElectronApplication` because the manager only calls a
  narrow event-emitter surface.
- **21-test baseline** — don't regress it. Adding a handler with
  new validation usually means +1 schema test.

## Security

- **Allowlist by default** when deploying. An empty allowlist
  permits anything — fine for local dev, wrong for anything
  touching real user apps.
- **`electron_evaluate_main` is off by default.** Flipping
  `ELECTRON_MCP_ALLOW_MAIN_EVALUATE=true` grants full Node access
  to the hosted Electron process. Only do this when the calling
  agent is trusted.
- **Never log secrets.** The logger stringifies `details` as-is.
  Don't put env vars, tokens, or passwords into `details`.
- See `docs/security.md` for the full threat model.

## Config discipline

- Config loads once at boot from env in `src/utils/config.ts`.
- Fail loud on bad input (invalid log level, negative timeouts,
  non-integer max sessions).
- New env vars: update `.env.example` and the table in README.md
  and in `AGENTS.md` → Non-negotiables section in the same commit.

## Commits

- **One logical change per commit.** Bug fix and refactor don't
  share a commit.
- **No AI provenance in commit messages.** `feat: X`, `fix: Y`,
  `docs: Z`, `chore(deps): …`, `test: …`, `style: …`. Never
  "generated by / co-authored-by / Claude / Codex".
- **Never skip hooks (`--no-verify`) or bypass signing.** If a
  hook fails, fix the underlying problem.
- **Don't force-push `main`.** Prefer `git merge` / revert-commits
  over rewriting history.
- If the tree already has `.git/`, use it. If it doesn't, make one
  baseline commit of the scaffolded state first before your
  focused commits.

## What to avoid

- `console.log` anywhere under `src/`. stdout is JSON-RPC only.
- `z.record(v)` (single arg) — that's Zod 3. Use `z.record(k, v)`.
- Reading `.errors` off a `ZodError`. Use `.issues`.
- `McpServer.registerTool(...)`. Stay with the lower-level `Server`.
- Mocking `ElectronApplication` or `Page`. Use the real binary via
  smoke tests.
- Adding `zod-to-json-schema` back. Zod 4's native
  `z.toJSONSchema` is our emitter now.
- `--force` / `--no-verify` / `-i` on git commands.
- Half-built abstractions for stretch-goal features (HTTP
  transport, tracing, DOM snapshot, IPC hooks). They live on the
  follow-up list in the plan doc, not in this codebase.
- Long multi-paragraph docstrings. One-line module header if the
  context earns it; otherwise nothing.

## Key references

- `README.md` — user-facing overview + env var reference.
- `docs/architecture.md` — module map, dispatch flow.
- `docs/tools.md` — every tool, its schema, its error codes.
- `docs/session-model.md` — session lifecycle, window refs.
- `docs/security.md` — allowlist, main-evaluate gate, threat model.
- `docs/superpowers/plans/` — in-progress / completed plans.
- `examples/` — request samples + login+screenshot workflow.
