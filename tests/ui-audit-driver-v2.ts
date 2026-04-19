/**
 * UI audit driver, v2 — uses the Sprint 1 MCP tools
 * (wait_for_selector, accessibility_snapshot, console_tail) instead of
 * the hand-rolled evaluate + sleep approach in v1. Tracks per-module
 * timings so we can diff against the original.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const OUT_DIR = '/tmp/llamactl-ui-audit-v2';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface Module {
  id: string;
  label: string;
}

const MODULES: Module[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'chat', label: 'Chat' },
  { id: 'plan', label: 'Plan' },
  { id: 'ops-chat', label: 'Operator Console' },
  { id: 'cost', label: 'Cost' },
  { id: 'pipelines', label: 'Pipelines' },
  { id: 'workloads', label: 'Workloads' },
  { id: 'models', label: 'Models' },
  { id: 'presets', label: 'Presets' },
  { id: 'pulls', label: 'Pulls' },
  { id: 'bench', label: 'Bench' },
  { id: 'server', label: 'Server' },
  { id: 'logs', label: 'Logs' },
  { id: 'lmstudio', label: 'LM Studio' },
  { id: 'settings', label: 'Settings' },
];

function parseArgs(argv: string[]): { executable: string; execArgs: string[] } {
  let executable: string | undefined;
  let execArgs: string[] = [];
  for (const a of argv.slice(2)) {
    if (a.startsWith('--executable=')) executable = a.slice('--executable='.length);
    else if (a.startsWith('--args=')) execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
  }
  if (!executable) throw new Error('--executable required');
  return { executable, execArgs };
}

class McpClient {
  private seq = 1;
  private pending = new Map<number, (res: JsonRpcResponse) => void>();
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>;
  constructor(proc: ChildProcessByStdio<Writable, Readable, null>) {
    this.proc = proc;
    const rl = createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const frame = JSON.parse(line) as JsonRpcResponse;
        const cb = this.pending.get(frame.id as number);
        if (cb) {
          this.pending.delete(frame.id as number);
          cb(frame);
        }
      } catch {
        /* skip */
      }
    });
  }
  send(method: string, params?: unknown, timeoutMs = 30_000): Promise<JsonRpcResponse> {
    const id = this.seq++;
    return new Promise((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectP(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolveP(res);
      });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  kill(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }
}

function parseEnvelope(res: JsonRpcResponse | null): unknown {
  if (!res) return null;
  const text = (res.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface A11yNode {
  role: string;
  name?: string;
  value?: string | number;
  checked?: boolean | 'mixed';
  disabled?: boolean;
  children?: A11yNode[];
}

function walk(node: A11yNode | null | undefined, fn: (n: A11yNode) => void): void {
  if (!node) return;
  fn(node);
  for (const c of node.children ?? []) walk(c, fn);
}

function summarizeA11y(tree: A11yNode | null): {
  heading: string | null;
  buttons: Array<{ name: string; disabled: boolean | undefined }>;
  roles: Record<string, number>;
} {
  let heading: string | null = null;
  const buttons: Array<{ name: string; disabled: boolean | undefined }> = [];
  const roles: Record<string, number> = {};
  walk(tree, (n) => {
    roles[n.role] = (roles[n.role] ?? 0) + 1;
    if (!heading && (n.role === 'heading' || n.role === 'HeaderAsNonLandmark')) {
      heading = n.name ?? null;
    }
    if (n.role === 'button') {
      buttons.push({ name: n.name ?? '', disabled: n.disabled });
    }
  });
  return { heading, buttons, roles };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  mkdirSync(OUT_DIR, { recursive: true });

  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);
  const log = (msg: string): void => console.log(`[audit-v2] ${msg}`);

  try {
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ui-audit-v2', version: '0.1.0' },
    });

    log(`launch ${args.executable}`);
    const launched = await client.send(
      'tools/call',
      {
        name: 'electron_launch',
        arguments: { executablePath: args.executable, args: args.execArgs },
      },
      60_000,
    );
    const launchEnv = parseEnvelope(launched) as { ok?: boolean; sessionId?: string };
    const sessionId = launchEnv?.sessionId;
    if (!sessionId) {
      console.error('launch failed', launchEnv);
      return;
    }
    log(`session ${sessionId}`);

    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_window',
        arguments: { sessionId, index: 0, timeoutMs: 30_000 },
      },
      35_000,
    );

    // Safety + post-mortem wiring BEFORE first interaction so every
    // module's work is recorded.
    await client.send(
      'tools/call',
      { name: 'electron_dialog_policy', arguments: { sessionId, policy: 'auto' } },
      5_000,
    );
    await client.send(
      'tools/call',
      {
        name: 'electron_trace_start',
        arguments: { sessionId, title: 'ui-audit-v2', sources: false },
      },
      5_000,
    );

    // Wait for first-render instead of sleeping.
    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_selector',
        arguments: {
          sessionId,
          selector: '[data-testid="dashboard-root"]',
          state: 'visible',
          timeout: 10_000,
        },
      },
      12_000,
    );

    interface Result {
      module: string;
      label: string;
      clickOk: boolean;
      durationMs: number;
      heading: string | null;
      buttonCount: number;
      buttons: Array<{ name: string; disabled: boolean | undefined }>;
      roles: Record<string, number>;
      consoleDelta: number;
      networkDelta: number;
      screenshotPath: string;
    }
    const results: Result[] = [];
    let priorConsoleSize = 0;
    let priorNetworkSize = 0;

    for (const mod of MODULES) {
      const start = Date.now();
      log(`→ ${mod.label}`);

      const clickRes = await client.send('tools/call', {
        name: 'electron_click',
        arguments: { sessionId, selector: `button[aria-label="${mod.label}"]` },
      });
      const clickOk =
        clickRes.error === undefined && (parseEnvelope(clickRes) as { ok?: boolean })?.ok !== false;

      const rootSelector = `[data-testid="${mod.id}-root"]`;
      await client.send(
        'tools/call',
        {
          name: 'electron_wait_for_selector',
          arguments: { sessionId, selector: rootSelector, state: 'visible', timeout: 8_000 },
        },
        10_000,
      );

      const a11y = await client.send(
        'tools/call',
        {
          name: 'electron_accessibility_snapshot',
          arguments: { sessionId, root: rootSelector, interestingOnly: true, timeout: 8_000 },
        },
        10_000,
      );
      const tree = (parseEnvelope(a11y) as { tree?: A11yNode | null })?.tree ?? null;
      const summary = summarizeA11y(tree);

      const screenshotPath = `${OUT_DIR}/${String(results.length + 1).padStart(2, '0')}-${mod.id}.png`;
      await client.send(
        'tools/call',
        {
          name: 'electron_screenshot',
          arguments: { sessionId, path: screenshotPath, fullPage: false },
        },
        10_000,
      );

      // Capture per-module deltas for the two ring buffers so flaky
      // behavior (unexpected request spike, console error) is pinned to
      // the module that triggered it.
      const cRes = await client.send(
        'tools/call',
        { name: 'electron_console_tail', arguments: { sessionId, limit: 1 } },
        5_000,
      );
      const cSize =
        (parseEnvelope(cRes) as { bufferSize?: number })?.bufferSize ?? priorConsoleSize;
      const consoleDelta = Math.max(0, cSize - priorConsoleSize);
      priorConsoleSize = cSize;

      const nRes = await client.send(
        'tools/call',
        { name: 'electron_network_tail', arguments: { sessionId, limit: 1 } },
        5_000,
      );
      const nSize =
        (parseEnvelope(nRes) as { bufferSize?: number })?.bufferSize ?? priorNetworkSize;
      const networkDelta = Math.max(0, nSize - priorNetworkSize);
      priorNetworkSize = nSize;

      results.push({
        module: mod.id,
        label: mod.label,
        clickOk,
        durationMs: Date.now() - start,
        heading: summary.heading,
        buttonCount: summary.buttons.length,
        buttons: summary.buttons,
        roles: summary.roles,
        consoleDelta,
        networkDelta,
        screenshotPath,
      });
    }

    // Drain console + network ring buffers into the final report so
    // everything is one JSON file per run.
    const tail = await client.send(
      'tools/call',
      { name: 'electron_console_tail', arguments: { sessionId, limit: 200, drain: true } },
      10_000,
    );
    const tailEnv = parseEnvelope(tail) as { entries?: unknown[]; bufferSize?: number; dropped?: number };

    const netAll = await client.send(
      'tools/call',
      { name: 'electron_network_tail', arguments: { sessionId, limit: 500, drain: true } },
      10_000,
    );
    const netEnv = parseEnvelope(netAll) as {
      entries?: Array<{ method: string; url: string; status?: number; resourceType?: string }>;
      dropped?: number;
    };
    const netEntries = netEnv?.entries ?? [];
    const byStatus = netEntries.reduce<Record<string, number>>((acc, e) => {
      const key = e.status !== undefined ? String(e.status) : 'pending';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const byResource = netEntries.reduce<Record<string, number>>((acc, e) => {
      const key = e.resourceType ?? 'unknown';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const failures = netEntries.filter(
      (e) => (e.status !== undefined && e.status >= 400),
    );

    // Stop tracing LAST so the trace captures every navigation and the
    // ring-buffer drains. Writes a .zip that can be replayed in
    // `playwright show-trace`.
    const tracePath = `${OUT_DIR}/trace.zip`;
    const traceRes = await client.send(
      'tools/call',
      { name: 'electron_trace_stop', arguments: { sessionId, path: tracePath } },
      30_000,
    );
    const traceEnv = parseEnvelope(traceRes) as { path?: string; byteLength?: number };

    writeFileSync(
      `${OUT_DIR}/report.json`,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          executable: args.executable,
          driver: 'v2-sprint1+3',
          modulesTested: results.length,
          totalMs: results.reduce((a, r) => a + r.durationMs, 0),
          trace: {
            path: traceEnv?.path ?? tracePath,
            byteLength: traceEnv?.byteLength ?? 0,
          },
          network: {
            total: netEntries.length,
            dropped: netEnv?.dropped ?? 0,
            byStatus,
            byResource,
            failureCount: failures.length,
            failures: failures.slice(0, 20),
          },
          console: {
            dropped: tailEnv?.dropped ?? 0,
            count: (tailEnv?.entries ?? []).length,
            entries: tailEnv?.entries ?? [],
          },
          results,
        },
        null,
        2,
      ),
    );
    log(`wrote ${OUT_DIR}/report.json + trace.zip (${traceEnv?.byteLength ?? 0} bytes)`);

    await client.send('tools/call', { name: 'electron_close', arguments: { sessionId } }, 10_000);
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('audit v2 crashed:', err);
  process.exit(1);
});
