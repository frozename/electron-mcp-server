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
