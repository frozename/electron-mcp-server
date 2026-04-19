import { zodToJsonSchema } from '../utils/zod-to-json.js';

import {
  ElectronAccessibilitySnapshotInputSchema,
  ElectronCloseInputSchema,
  ElectronConsoleTailInputSchema,
  ElectronFillInputSchema,
  ElectronFocusWindowInputSchema,
  ElectronLaunchInputSchema,
  ElectronListWindowsInputSchema,
  ElectronRestartInputSchema,
  ElectronScreenshotInputSchema,
  ElectronWaitForSelectorInputSchema,
  ElectronWaitForWindowInputSchema,
  ElectronClickInputSchema,
  ElectronEvaluateMainInputSchema,
  ElectronEvaluateRendererInputSchema,
} from '../schemas/index.js';

import { electronConsoleTail } from './console.js';
import {
  electronClose,
  electronLaunch,
  electronListSessions,
  electronRestart,
} from './lifecycle.js';
import { electronEvaluateMain } from './main.js';
import {
  electronAccessibilitySnapshot,
  electronClick,
  electronEvaluateRenderer,
  electronFill,
  electronScreenshot,
  electronWaitForSelector,
} from './renderer.js';
import type { ToolContext, ToolHandler } from './types.js';
import { electronFocusWindow, electronListWindows, electronWaitForWindow } from './windows.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: ToolHandler<unknown, unknown>;
}

/**
 * The authoritative tool registry. Names and ordering match the README.
 * Each entry pairs a JSON-schema advertised to MCP clients with the
 * async handler invoked when the tool is called.
 */
export function buildToolRegistry(): ToolDefinition[] {
  return [
    /* ---------------- Lifecycle ---------------- */
    {
      name: 'electron_launch',
      description:
        'Launch an Electron application via Playwright and return a session handle. ' +
        'Accepts an executable path, optional CLI args, env, cwd, and launch timeout.',
      inputSchema: zodToJsonSchema(ElectronLaunchInputSchema),
      handler: electronLaunch as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_close',
      description:
        'Close an active Electron session. Pass `force: true` to kill the process if ' +
        'graceful shutdown stalls.',
      inputSchema: zodToJsonSchema(ElectronCloseInputSchema),
      handler: electronClose as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_restart',
      description:
        'Close and relaunch an existing session using the same executable path and args.',
      inputSchema: zodToJsonSchema(ElectronRestartInputSchema),
      handler: electronRestart as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_list_sessions',
      description:
        'List every active Electron session, including status, labels, and window counts.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: (async (_input: unknown, ctx: ToolContext) =>
        electronListSessions(undefined, ctx)) as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Windows ---------------- */
    {
      name: 'electron_list_windows',
      description: 'Enumerate every window in a session with its title, URL, and close state.',
      inputSchema: zodToJsonSchema(ElectronListWindowsInputSchema),
      handler: electronListWindows as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_focus_window',
      description:
        'Bring a specific window to front. Window can be an index, URL substring, or title substring.',
      inputSchema: zodToJsonSchema(ElectronFocusWindowInputSchema),
      handler: electronFocusWindow as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_wait_for_window',
      description:
        'Wait until a window matching a URL/title pattern (or a specific index) is available.',
      inputSchema: zodToJsonSchema(ElectronWaitForWindowInputSchema),
      handler: electronWaitForWindow as unknown as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Renderer ---------------- */
    {
      name: 'electron_click',
      description: 'Click a DOM element in a renderer window using a CSS/Playwright selector.',
      inputSchema: zodToJsonSchema(ElectronClickInputSchema),
      handler: electronClick as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_fill',
      description: 'Fill an input or textarea with a value (replaces existing content).',
      inputSchema: zodToJsonSchema(ElectronFillInputSchema),
      handler: electronFill as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_evaluate_renderer',
      description:
        'Evaluate a JavaScript expression or function body in the renderer context of ' +
        'a window. Result must be JSON-serializable.',
      inputSchema: zodToJsonSchema(ElectronEvaluateRendererInputSchema),
      handler: electronEvaluateRenderer as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_screenshot',
      description:
        'Capture a screenshot of a window. Saves to a path if provided, otherwise returns base64.',
      inputSchema: zodToJsonSchema(ElectronScreenshotInputSchema),
      handler: electronScreenshot as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_wait_for_selector',
      description:
        'Wait until an element matching a selector reaches a state (visible | hidden | attached | ' +
        'detached). Replaces ad-hoc sleep loops. Returns {matched:true} on success, or throws a ' +
        'SelectorError on timeout.',
      inputSchema: zodToJsonSchema(ElectronWaitForSelectorInputSchema),
      handler: electronWaitForSelector as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_accessibility_snapshot',
      description:
        'Return the accessibility tree for a window (or element rooted at a selector). ' +
        'Compact text tree of roles/names/values — designed for LLM agents to reason about UI ' +
        'state without screenshots. interestingOnly defaults to true (Playwright default).',
      inputSchema: zodToJsonSchema(ElectronAccessibilitySnapshotInputSchema),
      handler: electronAccessibilitySnapshot as unknown as ToolHandler<unknown, unknown>,
    },
    {
      name: 'electron_console_tail',
      description:
        'Drain up to N recent entries from the session ring buffer of renderer console + page ' +
        'errors. Optional level and regex pattern filters. Set drain:true to remove the returned ' +
        'entries from the buffer so subsequent tails only see new messages.',
      inputSchema: zodToJsonSchema(ElectronConsoleTailInputSchema),
      handler: electronConsoleTail as unknown as ToolHandler<unknown, unknown>,
    },

    /* ---------------- Main process ---------------- */
    {
      name: 'electron_evaluate_main',
      description:
        'Evaluate a function body in the Electron main process. The function receives the ' +
        'Electron module as its first argument. Disabled by default for safety.',
      inputSchema: zodToJsonSchema(ElectronEvaluateMainInputSchema),
      handler: electronEvaluateMain as unknown as ToolHandler<unknown, unknown>,
    },
  ];
}

export type { ToolContext } from './types.js';
