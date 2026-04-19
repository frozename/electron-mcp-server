/**
 * K.2 — A/B compare mode flow test. Opens Chat, creates a new
 * conversation, enters compare mode, and asserts both panes exist;
 * then exits compare and confirms pane B is gone.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
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
  async call(tool: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.seq++;
    const res = await new Promise<JsonRpcResponse>((resolveP, rejectP) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectP(new Error(`timeout ${tool}`));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        resolveP(r);
      });
      this.proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: tool, arguments: args },
        }) + '\n',
      );
    });
    if (res.error) throw new Error(`${tool} → ${res.error.message}`);
    const envelope = res.result as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    const text = envelope?.content?.[0]?.text ?? '';
    if (envelope?.isError) throw new Error(`${tool} → ${text}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  initialize(): Promise<JsonRpcResponse> {
    const id = this.seq++;
    return new Promise((resolveP) => {
      this.pending.set(id, (r) => resolveP(r));
      this.proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'chat-compare-flow', version: '0.0.1' },
          },
        }) + '\n',
      );
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

function check(label: string, cond: boolean, detail = ''): void {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`[${mark}] ${label}${detail ? ' — ' + detail : ''}`);
  if (!cond) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const here = dirname(fileURLToPath(import.meta.url));
  const serverScript = resolve(here, '..', 'dist', 'server', 'index.js');
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.ELECTRON_MCP_LOG_LEVEL = env.ELECTRON_MCP_LOG_LEVEL ?? 'warn';
  const nodeBin = process.env.MCP_NODE ?? 'node';
  const proc = spawn(nodeBin, [serverScript], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const client = new McpClient(proc);

  try {
    await client.initialize();
    const launch = (await client.call(
      'electron_launch',
      { executablePath: args.executable, args: args.execArgs },
      60_000,
    )) as { sessionId?: string };
    const sessionId = launch.sessionId;
    if (!sessionId) throw new Error('launch failed');
    await client.call('electron_wait_for_window', { sessionId, index: 0, timeoutMs: 30_000 });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="dashboard-root"]',
      state: 'visible',
      timeout: 10_000,
    });

    // Open Chat.
    await client.call('electron_click', { sessionId, selector: 'button[aria-label="Chat"]' });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="chat-root"]',
      state: 'visible',
      timeout: 8_000,
    });

    // Empty state → click "New chat".
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="chat-new"]',
      state: 'visible',
      timeout: 5_000,
    });
    await client.call('electron_click', {
      sessionId,
      selector: '[data-testid="chat-new"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="chat-pane-a"]',
      state: 'visible',
      timeout: 5_000,
    });
    check('pane A visible after New chat', true);

    // Pane B should NOT be rendered yet.
    const before = (await client.call('electron_evaluate_renderer', {
      sessionId,
      expression: 'document.querySelectorAll("[data-testid=\\"chat-pane-b\\"]").length',
    })) as { result: number };
    check('pane B absent before compare', before.result === 0, `count=${before.result}`);

    // Enter compare mode.
    await client.call('electron_click', {
      sessionId,
      selector: '[data-testid="chat-compare"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="chat-pane-b"]',
      state: 'visible',
      timeout: 5_000,
    });
    check('pane B appears after Compare', true);

    // Both panes have their own node/model select plus capability pills.
    const dual = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="chat-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: unknown };
    const serialized = JSON.stringify(dual.tree ?? '');
    const comboBoxCount = (serialized.match(/"combobox"/g) ?? []).length;
    // Expect 4 selects: node+model on each pane.
    check(
      'dual panes expose 4 combobox selects',
      comboBoxCount >= 4,
      `comboboxes=${comboBoxCount}`,
    );

    // Exit compare.
    await client.call('electron_click', {
      sessionId,
      selector: '[data-testid="chat-compare-exit"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="chat-pane-b"]',
      state: 'detached',
      timeout: 5_000,
    });
    check('pane B removed after Exit compare', true);

    await client.call('electron_close', { sessionId });
    console.log(process.exitCode === 1 ? 'FAIL — see above' : 'PASS — all compare flow checks green');
  } catch (err) {
    console.error('flow crashed:', err);
    process.exitCode = 1;
  } finally {
    client.kill();
  }
}

main();
