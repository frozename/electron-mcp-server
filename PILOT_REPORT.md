# electron-mcp-server — Pilot Session Report

Session date: 2026-04-19
Driver: `tests/pilot-driver.ts` (extended during session)
Target app: `llamactl` Electron app (`packages/app/out/main/index.cjs`)
Electron version: 41.2.1 · Playwright version: 1.59.1

## Summary — PILOT PASSES CLEAN (0 findings)

The full pilot runs end-to-end against pure upstream Playwright 1.59.1
and Electron 41.2.1 with no monkey-patches to Playwright:

| Step                                              | Latency  |
| ------------------------------------------------- | -------- |
| `initialize`                                      | ~180 ms  |
| `tools/list`                                      | <1 ms    |
| `electron_close` (empty id) → validation envelope | ~1 ms    |
| `electron_launch` (bogus path) → allowlist deny   | <1 ms    |
| `electron_launch` (real app)                      | ~380 ms  |
| `electron_wait_for_window` (index 0)              | 7–170 ms |
| `electron_list_windows`                           | <20 ms   |
| `electron_evaluate_renderer: document.title`      | 5–26 ms  |
| Plan module: click → fill → Generate → poll       | 2.05 s   |
| Plan screenshot → `/tmp/electron-mcp-pilot-plan.png`  | 65 ms |
| Cost module: click → poll for tier + panes        | 4.09 s   |
| Cost screenshot → `/tmp/electron-mcp-pilot-cost.png`  | 54 ms |
| `electron_close`                                  | 137 ms   |

## Findings

### F1 — `electron.launch` stalls against Electron 41 — FALSE ALARM

Initial symptom: `electron.launch({ executablePath, args: [<main.cjs>] })`
timed out after 30 s; both the Node inspector and Chromium DevTools
WS attached, but launch never resolved.

**Actual root cause (not a Playwright bug):** the target app's tRPC
IPC layer was crashing on every call. electron-trpc v1.0.0-alpha.0's
renderer ipcLink reads `runtime.transformer.serialize(...)` (v10
shape), but tRPC v11's `TRPCUntypedClient.runtime` is an empty
object, so the very first IPC call in the renderer threw `Cannot
read properties of undefined (reading 'serialize')`. That in turn
kept the Chromium context in a state Playwright couldn't complete
its CDP attach against.

Once the llamactl IPC was fixed — custom v11-native ipcLink +
`getErrorShape` shim + v10 boolean flags on dispatcher procedures +
`getRawInput` back-fill — pure upstream Playwright 1.59.1 launches
Electron 41 in ~380 ms.

Fixes on the llamactl side:
- `packages/app/src/lib/ipc-link.ts` — v11-native `ipcLink`.
- `packages/app/electron/trpc/dispatcher.ts` — getErrorShape shim,
  v10-style flags, `getRawInput` back-fill.

No changes to Playwright required.

Lesson for future pilots: when `electron.launch` stalls with
DevTools already attached, check the renderer for a startup crash
*before* blaming Playwright's Electron adapter.

### F2 — `buildFunctionSource` returned `undefined` for IIFE expressions (MEDIUM, FIXED)

Pilot caught an off-by-one in the expression-wrapping heuristic used
by `electron_evaluate_renderer` / `electron_evaluate_main`. The
earlier version's regex `/\breturn\b/` matched *inside* nested
`return` statements of the passed expression, so Playwright
evaluated the IIFE as a bare statement and returned `undefined`.
Fixed by anchoring to the start: `/^return\b/`. Added seven
regression tests in `tests/build-function-source.test.ts`. All 28
existing unit tests remain green.

Before:
```ts
return /^\{[\s\S]*\}$/.test(trimmed) || /\breturn\b/.test(trimmed)
  ? trimmed
  : `return (${trimmed});`;
```

After:
```ts
return /^\{[\s\S]*\}$/.test(trimmed) || /^return\b/.test(trimmed)
  ? trimmed
  : `return (${trimmed});`;
```

### F3 — Pilot driver had to spawn the MCP server via Node, not Bun (MEDIUM, FIXED)

`tests/pilot-driver.ts` was spawning the MCP server via
`process.execPath`, which inherits the driver's interpreter. When
the driver is run under Bun (`bun tests/pilot-driver.ts`), that
resulted in the MCP server subprocess also running under Bun —
whose Node-inspector WebSocket handshake fails during Playwright's
electron.launch. Fixed by pinning the subprocess to `node` (overridable
with `MCP_NODE`):

```ts
const nodeBin = process.env.MCP_NODE ?? 'node';
const proc = spawn(nodeBin, [serverScript], { env, stdio: [...] });
```

### F4 — `initialize` response lacks capability self-description (LOW, OPEN)

`initialize` returns `{ protocolVersion, capabilities: {}, serverInfo }`.
Advertising `tools: { listChanged: true }` capability (even if we
never flip it) gives clients a clearer intent. Low-impact, drive-by.
Not touched this session.

## What the pilot validated

| Tool                           | Result                                                |
| ------------------------------ | ----------------------------------------------------- |
| `initialize`                   | ✓ round-trips in <200 ms                              |
| `tools/list`                   | ✓ 12 tools enumerated                                 |
| `electron_close` (empty id)    | ✓ returns `ok:false, code:validation_error`           |
| `electron_launch` (bogus path) | ✓ returns `ok:false, code:permission_denied`          |
| `electron_launch` (real app)   | ✓ returns sessionId in ~380 ms (Electron 41)          |
| `electron_wait_for_window`     | ✓ resolves first window by index                      |
| `electron_list_windows`        | ✓ returns populated list after wait                   |
| `electron_evaluate_renderer`   | ✓ runs sync + async expressions, IIFEs                |
| `electron_click`               | ✓ targets `[data-testid=…]` and `[aria-label=…]`      |
| `electron_fill`                | ✓ 300 ms write on a textarea                          |
| `electron_screenshot`          | ✓ writes PNG to `/tmp/electron-mcp-pilot-{plan,cost}.png` |
| `electron_close`               | ✓ clean teardown                                      |

## Unit tests

```
npx vitest run
# 28 pass, 0 fail — build-function-source, allowlist, errors, schemas, session-manager
```

Added this session: `tests/build-function-source.test.ts` (7 tests).

## Driver changes this session

`tests/pilot-driver.ts` was extended to:
- Spawn the MCP server under Node regardless of the driver's runtime
  (see F3).
- `electron_wait_for_window(index: 0)` before the first window-scoped
  tool call — Playwright's electron.launch resolves before the
  Electron main process creates a window.
- Drive the llamactl **Plan** module (click → fill goal → click
  Generate → poll for `[data-testid="plan-result"]`).
- Drive the llamactl **Cost** module (click Cost activity bar → poll
  for `[data-testid="cost-root"]` + `[data-testid="cost-tier"]`,
  validate daily/weekly/journal panes).
- Screenshot each module to `/tmp/electron-mcp-pilot-plan.png` and
  `/tmp/electron-mcp-pilot-cost.png`.
