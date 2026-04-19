import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  ElectronAccessibilitySnapshotInputSchema,
  ElectronAccessibilitySnapshotOutputSchema,
  ElectronClickInputSchema,
  ElectronEvaluateRendererInputSchema,
  ElectronFillInputSchema,
  ElectronScreenshotInputSchema,
  ElectronScreenshotOutputSchema,
  ElectronWaitForSelectorInputSchema,
  ElectronWaitForSelectorOutputSchema,
  EvaluateOutputSchema,
  type ElectronAccessibilitySnapshotInput,
  type ElectronAccessibilitySnapshotOutput,
  type ElectronClickInput,
  type ElectronEvaluateRendererInput,
  type ElectronFillInput,
  type ElectronScreenshotInput,
  type ElectronScreenshotOutput,
  type ElectronWaitForSelectorInput,
  type ElectronWaitForSelectorOutput,
  type EvaluateOutput,
  type OkWithSession,
} from '../schemas/index.js';

import type { ToolHandler } from './types.js';

export const electronClick: ToolHandler<ElectronClickInput, OkWithSession> = async (
  rawInput,
  ctx,
) => {
  const input = ElectronClickInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  const clickOptions: Parameters<typeof ctx.adapter.click>[2] = {
    button: input.button,
    clickCount: input.clickCount,
    force: input.force,
    timeoutMs,
  };
  if (input.delay !== undefined) clickOptions.delay = input.delay;

  await ctx.adapter.click(page, input.selector, clickOptions);
  ctx.sessions.touch(session);

  return { ok: true, sessionId: session.id };
};

export const electronFill: ToolHandler<ElectronFillInput, OkWithSession> = async (
  rawInput,
  ctx,
) => {
  const input = ElectronFillInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  await ctx.adapter.fill(page, input.selector, input.value, { timeoutMs });
  ctx.sessions.touch(session);

  return { ok: true, sessionId: session.id };
};

export const electronEvaluateRenderer: ToolHandler<
  ElectronEvaluateRendererInput,
  EvaluateOutput
> = async (rawInput, ctx) => {
  const input = ElectronEvaluateRendererInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.evaluateTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  const result = await ctx.adapter.evaluateRenderer(page, input.expression, input.arg, timeoutMs);
  ctx.sessions.touch(session);

  return EvaluateOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    result,
  });
};

export const electronScreenshot: ToolHandler<
  ElectronScreenshotInput,
  ElectronScreenshotOutput
> = async (rawInput, ctx) => {
  const input = ElectronScreenshotInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  let resolvedPath: string | undefined;
  if (input.path) {
    resolvedPath = path.resolve(input.path);
  } else if (ctx.config.screenshotDir) {
    // When no explicit path is given, optionally save under configured dir
    // using an auto-generated name — callers still receive base64 below.
    resolvedPath = undefined;
  }
  if (resolvedPath) {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  }

  const shotOpts: Parameters<typeof ctx.adapter.screenshot>[1] = {
    fullPage: input.fullPage,
    type: input.type,
    timeoutMs,
  };
  if (resolvedPath) shotOpts.path = resolvedPath;
  if (input.quality !== undefined) shotOpts.quality = input.quality;

  const buffer = await ctx.adapter.screenshot(page, shotOpts);
  ctx.sessions.touch(session);

  const output: ElectronScreenshotOutput = {
    ok: true,
    sessionId: session.id,
    ...(resolvedPath ? { path: resolvedPath } : { base64: buffer.toString('base64') }),
    byteLength: buffer.byteLength,
    type: input.type,
  };
  return ElectronScreenshotOutputSchema.parse(output);
};

export const electronWaitForSelector: ToolHandler<
  ElectronWaitForSelectorInput,
  ElectronWaitForSelectorOutput
> = async (rawInput, ctx) => {
  const input = ElectronWaitForSelectorInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  const matched = await ctx.adapter.waitForSelector(page, input.selector, {
    state: input.state,
    timeoutMs,
  });
  ctx.sessions.touch(session);

  return ElectronWaitForSelectorOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    state: input.state,
    matched,
  });
};

export const electronAccessibilitySnapshot: ToolHandler<
  ElectronAccessibilitySnapshotInput,
  ElectronAccessibilitySnapshotOutput
> = async (rawInput, ctx) => {
  const input = ElectronAccessibilitySnapshotInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const timeoutMs = input.timeout ?? ctx.config.actionTimeoutMs;
  const page = await ctx.adapter.resolveWindow(session.app, input.window);

  const snapOpts: Parameters<typeof ctx.adapter.accessibilitySnapshot>[1] = {
    interestingOnly: input.interestingOnly,
    timeoutMs,
  };
  if (input.root) snapOpts.root = input.root;

  const tree = await ctx.adapter.accessibilitySnapshot(page, snapOpts);
  ctx.sessions.touch(session);

  return ElectronAccessibilitySnapshotOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    tree: tree ?? null,
  });
};
