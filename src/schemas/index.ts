import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export const SessionIdSchema = z.string().min(1).describe('Opaque session identifier');

export const WindowRefSchema = z
  .union([
    z.number().int().nonnegative().describe('Window index (0-based)'),
    z.string().min(1).describe('Window URL, title pattern, or stable id'),
  ])
  .describe('Reference to a specific window in a session');

export const TimeoutSchema = z
  .number()
  .int()
  .positive()
  .max(300_000)
  .optional()
  .describe('Override timeout in milliseconds (max 5 min)');

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export const ElectronLaunchInputSchema = z.object({
  executablePath: z
    .string()
    .min(1)
    .describe('Absolute path to the Electron binary or app entry point'),
  args: z
    .array(z.string())
    .optional()
    .default([])
    .describe('Command-line arguments passed to Electron'),
  cwd: z.string().optional().describe('Working directory for the launched process'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables merged with the current process env'),
  timeout: TimeoutSchema,
  recordVideoDir: z
    .string()
    .optional()
    .describe('Directory for Playwright-recorded videos (optional)'),
  colorScheme: z.enum(['light', 'dark', 'no-preference']).optional(),
  label: z
    .string()
    .max(80)
    .optional()
    .describe('Human-friendly label stored with the session (for listings/logs)'),
});
export type ElectronLaunchInput = z.infer<typeof ElectronLaunchInputSchema>;

export const ElectronLaunchOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  label: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  windowCount: z.number().int().nonnegative(),
});
export type ElectronLaunchOutput = z.infer<typeof ElectronLaunchOutputSchema>;

export const ElectronCloseInputSchema = z.object({
  sessionId: SessionIdSchema,
  force: z.boolean().optional().default(false).describe('Kill the process if graceful close fails'),
});
export type ElectronCloseInput = z.infer<typeof ElectronCloseInputSchema>;

export const ElectronCloseOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  closed: z.boolean(),
});
export type ElectronCloseOutput = z.infer<typeof ElectronCloseOutputSchema>;

export const ElectronRestartInputSchema = z.object({
  sessionId: SessionIdSchema,
  timeout: TimeoutSchema,
});
export type ElectronRestartInput = z.infer<typeof ElectronRestartInputSchema>;

export const ElectronListSessionsOutputSchema = z.object({
  ok: z.literal(true),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      label: z.string().optional(),
      status: z.string(),
      executablePath: z.string(),
      startedAt: z.string(),
      lastUsedAt: z.string(),
      windowCount: z.number().int().nonnegative(),
    }),
  ),
});
export type ElectronListSessionsOutput = z.infer<typeof ElectronListSessionsOutputSchema>;

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

export const ElectronListWindowsInputSchema = z.object({
  sessionId: SessionIdSchema,
});
export type ElectronListWindowsInput = z.infer<typeof ElectronListWindowsInputSchema>;

export const WindowDescriptorSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string(),
  url: z.string(),
  isClosed: z.boolean(),
});
export type WindowDescriptor = z.infer<typeof WindowDescriptorSchema>;

export const ElectronListWindowsOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  windows: z.array(WindowDescriptorSchema),
});
export type ElectronListWindowsOutput = z.infer<typeof ElectronListWindowsOutputSchema>;

export const ElectronFocusWindowInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema,
});
export type ElectronFocusWindowInput = z.infer<typeof ElectronFocusWindowInputSchema>;

export const ElectronWaitForWindowInputSchema = z.object({
  sessionId: SessionIdSchema,
  urlPattern: z
    .string()
    .optional()
    .describe('Substring or regex (as string) to match in window URL'),
  titlePattern: z
    .string()
    .optional()
    .describe('Substring or regex (as string) to match in window title'),
  index: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('Wait until a window with this index exists'),
  timeout: TimeoutSchema,
});
export type ElectronWaitForWindowInput = z.infer<typeof ElectronWaitForWindowInputSchema>;

/* ------------------------------------------------------------------ */
/* Renderer interactions                                               */
/* ------------------------------------------------------------------ */

export const ElectronClickInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional().describe('Defaults to the focused / first window'),
  selector: z.string().min(1),
  button: z.enum(['left', 'right', 'middle']).optional().default('left'),
  clickCount: z.number().int().min(1).max(3).optional().default(1),
  delay: z.number().int().nonnegative().optional().describe('Delay between mousedown/up (ms)'),
  force: z.boolean().optional().default(false),
  timeout: TimeoutSchema,
});
export type ElectronClickInput = z.infer<typeof ElectronClickInputSchema>;

export const ElectronFillInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z.string().min(1),
  value: z.string(),
  timeout: TimeoutSchema,
});
export type ElectronFillInput = z.infer<typeof ElectronFillInputSchema>;

export const ElectronEvaluateRendererInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  expression: z
    .string()
    .min(1)
    .describe(
      'JavaScript expression or function body evaluated in the renderer context. Must return a JSON-serializable value.',
    ),
  arg: z
    .unknown()
    .optional()
    .describe('Optional argument (JSON-serializable) passed to the function body'),
  timeout: TimeoutSchema,
});
export type ElectronEvaluateRendererInput = z.infer<typeof ElectronEvaluateRendererInputSchema>;

export const ElectronScreenshotInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  fullPage: z.boolean().optional().default(false),
  path: z
    .string()
    .optional()
    .describe('Write screenshot to this path. If omitted, returns base64.'),
  type: z.enum(['png', 'jpeg']).optional().default('png'),
  quality: z.number().int().min(0).max(100).optional().describe('JPEG quality (ignored for PNG)'),
  timeout: TimeoutSchema,
});
export type ElectronScreenshotInput = z.infer<typeof ElectronScreenshotInputSchema>;

export const ElectronScreenshotOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  path: z.string().optional(),
  base64: z.string().optional(),
  byteLength: z.number().int().nonnegative(),
  type: z.enum(['png', 'jpeg']),
});
export type ElectronScreenshotOutput = z.infer<typeof ElectronScreenshotOutputSchema>;

/* ------------------------------------------------------------------ */
/* Wait for selector                                                   */
/* ------------------------------------------------------------------ */

export const WaitForSelectorStateSchema = z
  .enum(['attached', 'detached', 'visible', 'hidden'])
  .describe(
    'attached: element is in DOM. detached: element leaves DOM. visible: rendered & non-empty box. hidden: not visible or detached.',
  );

export const ElectronWaitForSelectorInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  selector: z.string().min(1),
  state: WaitForSelectorStateSchema.optional().default('visible'),
  timeout: TimeoutSchema,
});
export type ElectronWaitForSelectorInput = z.infer<typeof ElectronWaitForSelectorInputSchema>;

export const ElectronWaitForSelectorOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  state: WaitForSelectorStateSchema,
  matched: z.boolean(),
});
export type ElectronWaitForSelectorOutput = z.infer<typeof ElectronWaitForSelectorOutputSchema>;

/* ------------------------------------------------------------------ */
/* Accessibility snapshot                                              */
/* ------------------------------------------------------------------ */

export const ElectronAccessibilitySnapshotInputSchema = z.object({
  sessionId: SessionIdSchema,
  window: WindowRefSchema.optional(),
  interestingOnly: z
    .boolean()
    .optional()
    .default(true)
    .describe('Prune uninteresting nodes (Playwright default). false = full tree.'),
  root: z
    .string()
    .optional()
    .describe('Optional CSS selector. If set, snapshot is rooted at this element.'),
  timeout: TimeoutSchema,
});
export type ElectronAccessibilitySnapshotInput = z.infer<
  typeof ElectronAccessibilitySnapshotInputSchema
>;

export const AccessibilityNodeSchema: z.ZodType<AccessibilityNode> = z.lazy(() =>
  z.object({
    role: z.string(),
    name: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    description: z.string().optional(),
    checked: z.union([z.boolean(), z.literal('mixed')]).optional(),
    selected: z.boolean().optional(),
    disabled: z.boolean().optional(),
    expanded: z.boolean().optional(),
    focused: z.boolean().optional(),
    level: z.number().optional(),
    children: z.array(AccessibilityNodeSchema).optional(),
  }),
);
export interface AccessibilityNode {
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
  children?: AccessibilityNode[];
}

export const ElectronAccessibilitySnapshotOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  tree: AccessibilityNodeSchema.nullable(),
});
export type ElectronAccessibilitySnapshotOutput = z.infer<
  typeof ElectronAccessibilitySnapshotOutputSchema
>;

/* ------------------------------------------------------------------ */
/* Console tail                                                        */
/* ------------------------------------------------------------------ */

export const ConsoleEntrySchema = z.object({
  ts: z.string().describe('ISO timestamp when the entry was captured.'),
  kind: z.enum(['console', 'pageerror']),
  level: z
    .enum(['log', 'debug', 'info', 'warning', 'error', 'trace', 'dir', 'table', 'clear'])
    .optional()
    .describe('Playwright console-message type. Absent for pageerror.'),
  text: z.string(),
  windowIndex: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntrySchema>;

export const ElectronConsoleTailInputSchema = z.object({
  sessionId: SessionIdSchema,
  limit: z
    .number()
    .int()
    .positive()
    .max(1000)
    .optional()
    .default(100)
    .describe('Max entries to return (most recent).'),
  level: z
    .array(z.enum(['log', 'debug', 'info', 'warning', 'error']))
    .optional()
    .describe('Filter by console level. Omit to include every level.'),
  pattern: z
    .string()
    .optional()
    .describe('Regex (string) to filter entries by text. Case-sensitive.'),
  drain: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, clear the returned entries from the ring buffer.'),
});
export type ElectronConsoleTailInput = z.infer<typeof ElectronConsoleTailInputSchema>;

export const ElectronConsoleTailOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  entries: z.array(ConsoleEntrySchema),
  dropped: z
    .number()
    .int()
    .nonnegative()
    .describe('Count of entries evicted by the ring buffer since session start.'),
  bufferSize: z.number().int().nonnegative(),
});
export type ElectronConsoleTailOutput = z.infer<typeof ElectronConsoleTailOutputSchema>;

/* ------------------------------------------------------------------ */
/* Main process                                                        */
/* ------------------------------------------------------------------ */

export const ElectronEvaluateMainInputSchema = z.object({
  sessionId: SessionIdSchema,
  expression: z
    .string()
    .min(1)
    .describe(
      'JavaScript function body executed in the Electron main process. Receives the Electron module as its first argument.',
    ),
  arg: z.unknown().optional().describe('Optional JSON-serializable argument'),
  timeout: TimeoutSchema,
});
export type ElectronEvaluateMainInput = z.infer<typeof ElectronEvaluateMainInputSchema>;

/* ------------------------------------------------------------------ */
/* Generic evaluate response                                           */
/* ------------------------------------------------------------------ */

export const EvaluateOutputSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
  result: z.unknown(),
});
export type EvaluateOutput = z.infer<typeof EvaluateOutputSchema>;

/* ------------------------------------------------------------------ */
/* Generic OK response                                                 */
/* ------------------------------------------------------------------ */

export const OkWithSessionSchema = z.object({
  ok: z.literal(true),
  sessionId: z.string(),
});
export type OkWithSession = z.infer<typeof OkWithSessionSchema>;
