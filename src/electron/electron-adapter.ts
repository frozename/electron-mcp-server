import path from 'node:path';
import { promises as fs } from 'node:fs';

import { _electron as electron } from 'playwright';
import type { ElectronApplication, Page } from 'playwright';

import {
  EvaluationError,
  LaunchError,
  PermissionDeniedError,
  SelectorError,
  WindowNotFoundError,
  normalizeError,
} from '../errors/index.js';
import type { Logger } from '../logging/logger.js';
import type { ServerConfig } from '../utils/config.js';
import { matchesAllowlist } from '../utils/allowlist.js';
import { withTimeout } from '../utils/timeout.js';

export interface LaunchParams {
  executablePath: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  recordVideoDir?: string;
  colorScheme?: 'light' | 'dark' | 'no-preference';
}

/**
 * The Playwright-side facade. Keeps the rest of the codebase ignorant of
 * Playwright specifics so we can swap implementations or add tracing
 * without touching tool handlers.
 */
export class ElectronAdapter {
  constructor(
    private readonly config: ServerConfig,
    private readonly logger: Logger,
  ) {}

  async launch(params: LaunchParams): Promise<ElectronApplication> {
    const resolvedPath = path.resolve(params.executablePath);

    if (!matchesAllowlist(resolvedPath, this.config.executableAllowlist)) {
      throw new PermissionDeniedError(`Executable not in allowlist: ${resolvedPath}`, {
        executablePath: resolvedPath,
        allowlist: this.config.executableAllowlist,
      });
    }

    try {
      await fs.access(resolvedPath);
    } catch {
      throw new LaunchError(`Executable does not exist or is not accessible: ${resolvedPath}`, {
        executablePath: resolvedPath,
      });
    }

    this.logger.info('launching electron app', {
      executablePath: resolvedPath,
      args: params.args,
      cwd: params.cwd,
    });

    try {
      const launchOptions: Parameters<typeof electron.launch>[0] = {
        executablePath: resolvedPath,
        args: [...(params.args ?? [])],
        timeout: params.timeoutMs,
      };
      if (params.cwd) {
        launchOptions.cwd = params.cwd;
      }
      if (params.env) {
        launchOptions.env = { ...process.env, ...params.env } as Record<string, string>;
      }
      if (params.recordVideoDir) {
        launchOptions.recordVideo = { dir: params.recordVideoDir };
      }
      if (params.colorScheme) {
        launchOptions.colorScheme = params.colorScheme;
      }

      const app = await withTimeout(
        electron.launch(launchOptions),
        params.timeoutMs,
        'electron.launch',
      );

      return app;
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === 'timeout') {
        throw normalized;
      }
      throw new LaunchError(`Failed to launch electron app: ${normalized.message}`, {
        executablePath: resolvedPath,
        cause: normalized.message,
      });
    }
  }

  /**
   * Resolve a window reference (index | url substring | title substring)
   * to a Playwright `Page`. Throws `WindowNotFoundError` if unresolvable.
   */
  async resolveWindow(app: ElectronApplication, ref?: number | string): Promise<Page> {
    const windows = app.windows();
    if (windows.length === 0) {
      throw new WindowNotFoundError(ref ?? '<default>');
    }

    if (ref === undefined || ref === null) {
      const first = windows[0];
      if (!first) throw new WindowNotFoundError('<default>');
      return first;
    }

    if (typeof ref === 'number') {
      const page = windows[ref];
      if (!page) throw new WindowNotFoundError(ref);
      return page;
    }

    // String: match on URL substring/regex first, then title.
    const needle = ref;
    let pattern: RegExp | null = null;
    try {
      pattern = new RegExp(needle);
    } catch {
      pattern = null;
    }

    for (const win of windows) {
      const url = win.url();
      if (url === needle || url.includes(needle) || (pattern && pattern.test(url))) {
        return win;
      }
    }

    const titles = await Promise.all(
      windows.map(async (win) => {
        try {
          return await win.title();
        } catch {
          return '';
        }
      }),
    );
    for (let i = 0; i < windows.length; i++) {
      const title = titles[i] ?? '';
      const page = windows[i];
      if (!page) continue;
      if (title === needle || title.includes(needle) || (pattern && pattern.test(title))) {
        return page;
      }
    }

    throw new WindowNotFoundError(ref);
  }

  async describeWindow(
    win: Page,
    index: number,
  ): Promise<{ index: number; title: string; url: string; isClosed: boolean }> {
    const isClosed = win.isClosed();
    const url = win.url();
    let title = '';
    if (!isClosed) {
      try {
        title = await win.title();
      } catch {
        title = '';
      }
    }
    return { index, title, url, isClosed };
  }

  async listWindows(
    app: ElectronApplication,
  ): Promise<{ index: number; title: string; url: string; isClosed: boolean }[]> {
    const windows = app.windows();
    return Promise.all(windows.map((win, i) => this.describeWindow(win, i)));
  }

  /**
   * Wait until a window matching the predicate exists. Resolves with the
   * matched page; rejects with `WindowNotFoundError` (wrapped in a timeout
   * if the deadline is reached).
   */
  async waitForWindow(
    app: ElectronApplication,
    predicate: { urlPattern?: string; titlePattern?: string; index?: number },
    timeoutMs: number,
  ): Promise<Page> {
    const match = async (): Promise<Page | null> => {
      const windows = app.windows();
      if (predicate.index !== undefined) {
        const byIdx = windows[predicate.index];
        return byIdx ?? null;
      }
      for (const win of windows) {
        const url = win.url();
        if (predicate.urlPattern) {
          const re = safeRegex(predicate.urlPattern);
          if (url.includes(predicate.urlPattern) || (re && re.test(url))) return win;
        }
        if (predicate.titlePattern) {
          try {
            const title = await win.title();
            const re = safeRegex(predicate.titlePattern);
            if (title.includes(predicate.titlePattern) || (re && re.test(title))) {
              return win;
            }
          } catch {
            // ignore; the page may be mid-load
          }
        }
      }
      return null;
    };

    const existing = await match();
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        app.off('window', onWindow);
        reject(new WindowNotFoundError(describePredicate(predicate)));
      }, timeoutMs);

      const onWindow = async (): Promise<void> => {
        try {
          const found = await match();
          if (found) {
            clearTimeout(timer);
            app.off('window', onWindow);
            resolve(found);
          }
        } catch (err) {
          clearTimeout(timer);
          app.off('window', onWindow);
          reject(normalizeError(err));
        }
      };
      app.on('window', onWindow);
    });
  }

  async click(
    win: Page,
    selector: string,
    options: {
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
      delay?: number;
      force?: boolean;
      timeoutMs: number;
    },
  ): Promise<void> {
    try {
      const clickOptions: Parameters<Page['click']>[1] = {
        timeout: options.timeoutMs,
        button: options.button ?? 'left',
        clickCount: options.clickCount ?? 1,
        force: options.force ?? false,
      };
      if (options.delay !== undefined) {
        clickOptions.delay = options.delay;
      }
      await win.click(selector, clickOptions);
    } catch (err) {
      throw this.translateElementError(err, selector);
    }
  }

  async fill(
    win: Page,
    selector: string,
    value: string,
    options: { timeoutMs: number },
  ): Promise<void> {
    try {
      await win.fill(selector, value, { timeout: options.timeoutMs });
    } catch (err) {
      throw this.translateElementError(err, selector);
    }
  }

  async waitForSelector(
    win: Page,
    selector: string,
    options: {
      state: 'attached' | 'detached' | 'visible' | 'hidden';
      timeoutMs: number;
    },
  ): Promise<boolean> {
    try {
      const handle = await win.waitForSelector(selector, {
        state: options.state,
        timeout: options.timeoutMs,
      });
      // For detached/hidden states Playwright resolves with null and throws on timeout.
      // Convert to a boolean so callers can distinguish "matched" from "no element".
      return handle !== null || options.state === 'detached' || options.state === 'hidden';
    } catch (err) {
      throw this.translateElementError(err, selector);
    }
  }

  async accessibilitySnapshot(
    win: Page,
    options: {
      interestingOnly: boolean;
      root?: string;
      timeoutMs: number;
    },
  ): Promise<unknown> {
    // Playwright 1.54+ dropped `page.accessibility.snapshot()` from its public
    // API. We go to CDP (`Accessibility.getFullAXTree`) instead — same
    // underlying tree Chrome exposes, works identically in Electron.
    try {
      const client = await win.context().newCDPSession(win);
      try {
        await client.send('Accessibility.enable');

        type AXValue = { value?: unknown; type?: string };
        interface AXPropertyValue { name: string; value?: AXValue }
        interface AXNodeRaw {
          nodeId: string;
          parentId?: string;
          role?: AXValue;
          name?: AXValue;
          value?: AXValue;
          description?: AXValue;
          properties?: AXPropertyValue[];
          childIds?: string[];
          ignored?: boolean;
        }

        let raw: { nodes: AXNodeRaw[] };
        if (options.root) {
          // Wait for the selector to exist in the DOM first, then resolve it
          // to a CDP objectId via Runtime.evaluate. Avoids depending on any
          // Playwright internal ElementHandle shape.
          await win.waitForSelector(options.root, {
            state: 'attached',
            timeout: options.timeoutMs,
          });
          const evaluated = (await client.send('Runtime.evaluate', {
            expression: `document.querySelector(${JSON.stringify(options.root)})`,
            returnByValue: false,
            includeCommandLineAPI: false,
          })) as { result?: { objectId?: string; subtype?: string } };
          const objectId = evaluated.result?.objectId;
          if (!objectId || evaluated.result?.subtype === 'null') {
            throw new SelectorError(options.root, 'root not found');
          }
          const described = (await client.send('DOM.describeNode', {
            objectId,
          })) as { node?: { backendNodeId?: number } };
          const backendNodeId = described.node?.backendNodeId;
          if (backendNodeId === undefined) {
            throw new SelectorError(options.root, 'could not resolve backendNodeId');
          }
          raw = (await withTimeout(
            client.send('Accessibility.getPartialAXTree', {
              backendNodeId,
              fetchRelatives: true,
            }),
            options.timeoutMs,
            'cdp.accessibility.getPartialAXTree',
          )) as { nodes: AXNodeRaw[] };
        } else {
          raw = (await withTimeout(
            client.send('Accessibility.getFullAXTree', {}),
            options.timeoutMs,
            'cdp.accessibility.getFullAXTree',
          )) as { nodes: AXNodeRaw[] };
        }

        return axTreeToSnapshot(raw.nodes, { interestingOnly: options.interestingOnly });
      } finally {
        try {
          await client.detach();
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (err instanceof SelectorError) throw err;
      throw new EvaluationError(
        `Accessibility snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async evaluateRenderer(
    win: Page,
    expression: string,
    arg: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const body = buildFunctionSource(expression);
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const fn = new Function('arg', body) as (a: unknown) => unknown;
      const result = await withTimeout(win.evaluate(fn, arg), timeoutMs, 'renderer.evaluate');
      return result;
    } catch (err) {
      throw new EvaluationError(
        `Renderer evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
        { expressionLength: expression.length },
      );
    }
  }

  async evaluateMain(
    app: ElectronApplication,
    expression: string,
    arg: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const body = buildFunctionSource(expression);
    try {
      // The main-process evaluator receives `{ app, ... }` as the first
      // argument and our user-supplied `arg` as the second. We wrap the
      // caller-provided body so both arguments are in scope.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const wrapped = new Function('electron', 'arg', body) as (
        electronMod: unknown,
        a: unknown,
      ) => unknown;

      const result = await withTimeout(app.evaluate(wrapped, arg), timeoutMs, 'main.evaluate');
      return result;
    } catch (err) {
      throw new EvaluationError(
        `Main process evaluate failed: ${err instanceof Error ? err.message : String(err)}`,
        { expressionLength: expression.length },
      );
    }
  }

  async screenshot(
    win: Page,
    options: {
      fullPage?: boolean;
      path?: string;
      type: 'png' | 'jpeg';
      quality?: number;
      timeoutMs: number;
    },
  ): Promise<Buffer> {
    const screenshotOpts: Parameters<Page['screenshot']>[0] = {
      fullPage: options.fullPage ?? false,
      type: options.type,
      timeout: options.timeoutMs,
    };
    if (options.path) {
      screenshotOpts.path = options.path;
    }
    if (options.type === 'jpeg' && options.quality !== undefined) {
      screenshotOpts.quality = options.quality;
    }
    try {
      return await win.screenshot(screenshotOpts);
    } catch (err) {
      throw new EvaluationError(
        `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private translateElementError(err: unknown, selector: string): Error {
    const message = err instanceof Error ? err.message : String(err);
    if (/timeout/i.test(message)) {
      // Let the caller know which selector timed out without losing the category.
      return new SelectorError(selector, 'timeout waiting for element');
    }
    return new SelectorError(selector, message);
  }
}

function safeRegex(input: string): RegExp | null {
  try {
    return new RegExp(input);
  } catch {
    return null;
  }
}

interface AXSnapshotValue { value?: unknown; type?: string }
interface AXSnapshotProperty { name: string; value?: AXSnapshotValue }
interface AXSnapshotNodeRaw {
  nodeId: string;
  parentId?: string;
  role?: AXSnapshotValue;
  name?: AXSnapshotValue;
  value?: AXSnapshotValue;
  description?: AXSnapshotValue;
  properties?: AXSnapshotProperty[];
  childIds?: string[];
  ignored?: boolean;
}

interface AXSnapshotOut {
  role: string;
  name?: string;
  value?: string | number;
  description?: string;
  checked?: boolean | 'mixed';
  selected?: boolean;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  level?: number;
  children?: AXSnapshotOut[];
}

function valueOf(v: AXSnapshotValue | undefined): unknown {
  return v?.value;
}

function axTreeToSnapshot(
  nodes: AXSnapshotNodeRaw[],
  options: { interestingOnly: boolean },
): AXSnapshotOut | null {
  const byId = new Map<string, AXSnapshotNodeRaw>();
  for (const n of nodes) byId.set(n.nodeId, n);

  // Pick the root: prefer a node with no parentId, else the first.
  const root = nodes.find((n) => !n.parentId) ?? nodes[0];
  if (!root) return null;

  const convert = (n: AXSnapshotNodeRaw): AXSnapshotOut | null => {
    const roleRaw = valueOf(n.role);
    const role = typeof roleRaw === 'string' ? roleRaw : '';

    // Drop "InlineTextBox", "none" and ignored nodes under interestingOnly.
    if (options.interestingOnly) {
      if (n.ignored) return collapse(n);
      if (role === '' || role === 'none' || role === 'presentation' || role === 'InlineTextBox') {
        return collapse(n);
      }
    }

    const out: AXSnapshotOut = { role };
    const name = valueOf(n.name);
    if (typeof name === 'string' && name.length > 0) out.name = name;
    const value = valueOf(n.value);
    if (typeof value === 'string' || typeof value === 'number') out.value = value;
    const desc = valueOf(n.description);
    if (typeof desc === 'string' && desc.length > 0) out.description = desc;

    for (const prop of n.properties ?? []) {
      const v = valueOf(prop.value);
      switch (prop.name) {
        case 'checked':
          if (v === 'mixed') out.checked = 'mixed';
          else if (typeof v === 'boolean') out.checked = v;
          break;
        case 'selected':
          if (typeof v === 'boolean') out.selected = v;
          break;
        case 'disabled':
          if (typeof v === 'boolean') out.disabled = v;
          break;
        case 'expanded':
          if (typeof v === 'boolean') out.expanded = v;
          break;
        case 'focused':
          if (typeof v === 'boolean') out.focused = v;
          break;
        case 'level':
          if (typeof v === 'number') out.level = v;
          break;
      }
    }

    const kids: AXSnapshotOut[] = [];
    for (const childId of n.childIds ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      const rendered = convert(child);
      if (Array.isArray(rendered)) kids.push(...rendered);
      else if (rendered) kids.push(rendered);
    }
    if (kids.length > 0) out.children = kids;
    return out;
  };

  const collapse = (n: AXSnapshotNodeRaw): AXSnapshotOut | null => {
    const kids: AXSnapshotOut[] = [];
    for (const childId of n.childIds ?? []) {
      const child = byId.get(childId);
      if (!child) continue;
      const rendered = convert(child);
      if (rendered) kids.push(rendered);
    }
    if (kids.length === 0) return null;
    if (kids.length === 1) return kids[0]!;
    // Fold multiple children into a synthetic "group" so we don't lose them.
    return { role: 'group', children: kids };
  };

  return convert(root);
}

function describePredicate(p: {
  urlPattern?: string;
  titlePattern?: string;
  index?: number;
}): string {
  const parts: string[] = [];
  if (p.urlPattern) parts.push(`url~=${p.urlPattern}`);
  if (p.titlePattern) parts.push(`title~=${p.titlePattern}`);
  if (p.index !== undefined) parts.push(`index=${p.index}`);
  return parts.length > 0 ? parts.join(',') : '<any>';
}

/**
 * Accept either:
 *   - a full function body (multi-line with `return`) — used as-is
 *   - a single expression                           — wrapped in `return (<expr>);`
 * The `arg` / `electron` / `arg` identifiers are made available via the
 * wrapping `new Function(...)` signature.
 */
export function buildFunctionSource(expression: string): string {
  const trimmed = expression.trim();
  // Three shapes the caller may supply:
  //   1. Block body in braces:         `{ const x = 1; return x; }`
  //   2. Explicit `return` statement:  `return document.title;`
  //   3. Bare expression:              `document.title` / `(async () => { … })()`
  //
  // The earlier heuristic also matched any occurrence of the word
  // `return` — even nested inside an IIFE — and treated the whole
  // string as a statement, which silently evaluated the IIFE without
  // a top-level return. That returned `undefined` from the
  // `new Function('arg', body)` wrapper. Fix: only treat the input
  // as a statement form when `return` appears as the literal top-
  // level keyword (`return …`) or the string is wrapped in braces.
  if (/^\{[\s\S]*\}$/.test(trimmed) || /^return\b/.test(trimmed)) {
    return trimmed;
  }
  return `return (${trimmed});`;
}
