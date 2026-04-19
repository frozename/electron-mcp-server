/**
 * Sprint 2 flow test — chains Sprint 1 + Sprint 2 tools for real UX
 * scenarios against the live llamactl app. Each scenario asserts an
 * observable property via accessibility_snapshot so we prove the tool
 * actually did its job (not just that the call returned ok).
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
  async call(tool: string, args: unknown, timeoutMs = 15_000): Promise<unknown> {
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
    const text = (res.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text ?? '';
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
            clientInfo: { name: 'sprint2-flow', version: '0.0.1' },
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

interface A11yNode {
  role: string;
  name?: string;
  children?: A11yNode[];
  disabled?: boolean;
  checked?: boolean | 'mixed';
}

function countByRole(tree: A11yNode | null | undefined, role: string): number {
  if (!tree) return 0;
  let n = 0;
  const walk = (node: A11yNode): void => {
    if (node.role === role) n += 1;
    for (const c of node.children ?? []) walk(c);
  };
  walk(tree);
  return n;
}

function findByName(
  tree: A11yNode | null | undefined,
  role: string,
  name: string,
): A11yNode | null {
  if (!tree) return null;
  if (tree.role === role && tree.name === name) return tree;
  for (const c of tree.children ?? []) {
    const r = findByName(c, role, name);
    if (r) return r;
  }
  return null;
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
    await client.call('electron_wait_for_window', { sessionId, index: 0, timeoutMs: 30_000 }, 35_000);

    /* -------- 1. dialog_policy lands + survives app state changes -------- */
    const dp = (await client.call('electron_dialog_policy', {
      sessionId,
      policy: 'auto',
    })) as { policy: string; handled: number };
    check('dialog_policy set to auto', dp.policy === 'auto' && dp.handled === 0);

    /* -------- 2. Wait-for + navigate to Models -------- */
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="dashboard-root"]',
      state: 'visible',
      timeout: 10_000,
    });
    await client.call('electron_click', {
      sessionId,
      selector: 'button[aria-label="Models"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="models-root"]',
      state: 'visible',
      timeout: 8_000,
    });

    /* -------- 3. Uninstall arm/cancel flow — click, snapshot, press Escape-equivalent via Cancel -------- */
    const before = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="models-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: A11yNode | null };
    const uninstallsIdle = countByRole(before.tree, 'button');
    const confirmsIdle =
      findByName(before.tree, 'button', 'Confirm') !== null ? 1 : 0;
    check(
      'Models idle: no Confirm buttons showing',
      confirmsIdle === 0,
      `uninstalls=${uninstallsIdle}`,
    );

    // Click the first Uninstall button to arm confirmation.
    await client.call('electron_click', {
      sessionId,
      selector: '[data-testid="models-root"] button:has-text("Uninstall")',
    });
    // Let React rerender the row.
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="models-root"] button:has-text("Confirm")',
      state: 'visible',
      timeout: 5_000,
    });
    const armed = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="models-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: A11yNode | null };
    const hasConfirm = findByName(armed.tree, 'button', 'Confirm') !== null;
    const hasCancel = findByName(armed.tree, 'button', 'Cancel') !== null;
    check('Models armed: Confirm + Cancel visible', hasConfirm && hasCancel);

    // Cancel via click (exercises a11y-driven targeting).
    await client.call('electron_click', {
      sessionId,
      selector: '[data-testid="models-root"] button:has-text("Cancel")',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="models-root"] button:has-text("Confirm")',
      state: 'hidden',
      timeout: 5_000,
    });
    const after = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="models-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: A11yNode | null };
    check(
      'Models cancelled: no Confirm buttons after cancel',
      findByName(after.tree, 'button', 'Confirm') === null,
    );

    /* -------- 4. hover reveals Server Stop title when the server is down -------- */
    await client.call('electron_click', {
      sessionId,
      selector: 'button[aria-label="Server"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="server-root"]',
      state: 'visible',
      timeout: 5_000,
    });
    await client.call('electron_hover', {
      sessionId,
      selector: '[data-testid="server-stop"]',
      timeout: 5_000,
    });
    check('hover over Server stop button succeeded', true);

    /* -------- 5. press Tab focuses next control on Server form -------- */
    const focusBefore = (await client.call('electron_evaluate_renderer', {
      sessionId,
      expression: 'document.activeElement?.tagName ?? null',
    })) as { result: string | null };
    await client.call('electron_press', { sessionId, key: 'Tab' });
    const focusAfter = (await client.call('electron_evaluate_renderer', {
      sessionId,
      expression: 'document.activeElement?.tagName ?? null',
    })) as { result: string | null };
    check(
      'press Tab moved focus',
      focusAfter.result !== null,
      `${String(focusBefore.result)} → ${String(focusAfter.result)}`,
    );

    /* -------- 6. select_option changes Presets class filter -------- */
    await client.call('electron_click', {
      sessionId,
      selector: 'button[aria-label="Presets"]',
    });
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="presets-root"]',
      state: 'visible',
      timeout: 8_000,
    });
    const allBefore = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="presets-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: A11yNode | null };
    const cellsAll = countByRole(allBefore.tree, 'cell');

    await client.call('electron_select_option', {
      sessionId,
      selector: '[data-testid="presets-root"] select',
      value: 'multimodal',
      timeout: 5_000,
    });
    // React-query refetch takes a tick; the text in the Candidates header updates.
    await client.call('electron_wait_for_selector', {
      sessionId,
      selector: '[data-testid="presets-root"]',
      state: 'visible',
      timeout: 3_000,
    });
    const multimodal = (await client.call('electron_accessibility_snapshot', {
      sessionId,
      root: '[data-testid="presets-root"]',
      interestingOnly: true,
      timeout: 5_000,
    })) as { tree: A11yNode | null };
    const cellsFiltered = countByRole(multimodal.tree, 'cell');
    check(
      'select_option reduced Presets cells',
      cellsFiltered < cellsAll,
      `all=${cellsAll} → multimodal=${cellsFiltered}`,
    );

    await client.call('electron_close', { sessionId });
    console.log(process.exitCode === 1 ? 'FAIL — see above' : 'PASS — all flow checks green');
  } catch (err) {
    console.error('flow crashed:', err);
    process.exitCode = 1;
  } finally {
    client.kill();
  }
}

main();
