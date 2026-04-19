#!/usr/bin/env node
/**
 * UI audit driver for the llamactl Electron app. Launches the app via
 * electron-mcp, clicks through every module registered in
 * packages/app/src/modules/registry.ts, takes a screenshot and a DOM
 * snapshot of each, then writes a report to /tmp/llamactl-ui-audit/.
 *
 * Usage:
 *   node tests/ui-audit-driver.ts --executable=/path/to/electron --args='/path/to/main.cjs'
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

const MODULES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'nodes', label: 'Nodes' },
  { id: 'chat', label: 'Chat' },
  { id: 'plan', label: 'Plan' },
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

const OUT_DIR = '/tmp/llamactl-ui-audit';

interface Args {
  executable: string;
  execArgs: string[];
  allowlist?: string;
}

function parseArgs(argv: string[]): Args {
  let executable = '';
  let execArgs: string[] = [];
  let allowlist: string | undefined;
  for (const a of argv.slice(2)) {
    if (a.startsWith('--executable=')) executable = a.slice('--executable='.length);
    else if (a.startsWith('--args=')) execArgs = a.slice('--args='.length).split(' ').filter(Boolean);
    else if (a.startsWith('--allowlist=')) allowlist = a.slice('--allowlist='.length);
  }
  if (!executable) throw new Error('--executable required');
  return { executable, execArgs, allowlist };
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
        // skip
      }
    });
  }
  send(method: string, params?: unknown, timeoutMs = 30_000): Promise<JsonRpcResponse> {
    const id = this.seq++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  mkdirSync(OUT_DIR, { recursive: true });

  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');
  if (!existsSync(serverScript)) throw new Error(`build first: ${serverScript}`);

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args.allowlist) env.ELECTRON_MCP_EXECUTABLE_ALLOWLIST = args.allowlist;
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';

  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], {
    env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const client = new McpClient(proc);

  const log = (msg: string): void => console.log(`[audit] ${msg}`);

  const results: Array<{
    module: string;
    label: string;
    clickOk: boolean;
    snapshot: unknown;
    screenshotPath: string;
  }> = [];

  try {
    log('initialize');
    await client.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ui-audit', version: '0.0.1' },
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
    const env1 = parseEnvelope(launched) as { ok?: boolean; sessionId?: string };
    if (!env1?.sessionId) {
      console.error('launch failed', env1);
      return;
    }
    const sessionId = env1.sessionId;
    log(`session ${sessionId}`);

    await client.send(
      'tools/call',
      {
        name: 'electron_wait_for_window',
        arguments: { sessionId, index: 0, timeoutMs: 30_000 },
      },
      35_000,
    );

    // Let the initial dashboard render settle before we start clicking.
    await new Promise((r) => setTimeout(r, 800));

    for (const mod of MODULES) {
      log(`→ ${mod.label}`);
      const clickRes = await client.send('tools/call', {
        name: 'electron_click',
        arguments: { sessionId, selector: `button[aria-label="${mod.label}"]` },
      });
      const clickOk = (clickRes.error === undefined) && (parseEnvelope(clickRes) as { ok?: boolean })?.ok !== false;

      // Poll until content appears / re-renders. Each module has its own
      // top-level root or heading; capture a wide-net snapshot.
      await new Promise((r) => setTimeout(r, 600));

      const snapRes = await client.send(
        'tools/call',
        {
          name: 'electron_evaluate_renderer',
          arguments: {
            sessionId,
            expression: `(() => {
              const active = document.querySelector('button[aria-label][data-active="true"], button[aria-label].active, button[aria-label][aria-current="page"]');
              const main = document.querySelector('main') ?? document.body;
              const heading = main.querySelector('h1, h2, [role="heading"]')?.textContent?.trim() ?? null;
              const testIds = Array.from(main.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid')).slice(0, 40);
              const errorEls = Array.from(main.querySelectorAll('[data-testid*="error"], [class*="error"], [role="alert"]'))
                .map(e => e.textContent?.trim()?.slice(0, 200))
                .filter(Boolean)
                .slice(0, 10);
              const loadingEls = Array.from(main.querySelectorAll('[data-testid*="loading"], [class*="loading"], [class*="skeleton"]')).length;
              const emptyStateEls = Array.from(main.querySelectorAll('[data-testid*="empty"]'))
                .map(e => e.textContent?.trim()?.slice(0, 160))
                .filter(Boolean);
              const buttons = Array.from(main.querySelectorAll('button')).slice(0, 40).map(b => ({
                text: b.textContent?.trim()?.slice(0, 60),
                disabled: b.disabled,
                ariaLabel: b.getAttribute('aria-label'),
              }));
              const textSample = main.textContent?.replace(/\\s+/g, ' ').slice(0, 600) ?? '';
              return {
                activeAriaLabel: active?.getAttribute('aria-label') ?? null,
                heading,
                testIds,
                errorEls,
                emptyStateEls,
                loadingCount: loadingEls,
                buttonCount: main.querySelectorAll('button').length,
                buttons,
                textSample,
                viewport: { w: window.innerWidth, h: window.innerHeight },
              };
            })()`,
          },
        },
        15_000,
      );
      const snapshot = parseEnvelope(snapRes);

      const screenshotPath = `${OUT_DIR}/${String(results.length + 1).padStart(2, '0')}-${mod.id}.png`;
      await client.send(
        'tools/call',
        {
          name: 'electron_screenshot',
          arguments: { sessionId, path: screenshotPath, fullPage: false },
        },
        10_000,
      );

      results.push({ module: mod.id, label: mod.label, clickOk, snapshot, screenshotPath });
    }

    // Also pull the renderer console log for the whole session — helps
    // catch runtime errors that don't render as visible UI.
    const consoleDump = await client.send(
      'tools/call',
      {
        name: 'electron_evaluate_renderer',
        arguments: {
          sessionId,
          expression: `(() => {
            // There's no console-history API in Chromium; we scrape what
            // we've intentionally logged on window.__llamactlConsole if
            // any. Otherwise we just report the current location + any
            // tRPC error state surfaces.
            return {
              llamactlConsole: window.__llamactlConsole ?? null,
              href: location.href,
            };
          })()`,
        },
      },
      10_000,
    );

    writeFileSync(
      `${OUT_DIR}/report.json`,
      JSON.stringify(
        {
          runAt: new Date().toISOString(),
          executable: args.executable,
          modulesTested: results.length,
          results,
          consoleDump: parseEnvelope(consoleDump),
        },
        null,
        2,
      ),
    );
    log(`wrote ${OUT_DIR}/report.json`);

    await client.send('tools/call', { name: 'electron_close', arguments: { sessionId } }, 10_000);
  } finally {
    client.kill();
  }
}

main().catch((err) => {
  console.error('audit crashed:', err);
  process.exit(2);
});
