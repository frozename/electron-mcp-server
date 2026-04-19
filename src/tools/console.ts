import {
  ElectronConsoleTailInputSchema,
  ElectronConsoleTailOutputSchema,
  type ConsoleEntry,
  type ElectronConsoleTailInput,
  type ElectronConsoleTailOutput,
} from '../schemas/index.js';

import type { ToolHandler } from './types.js';

function matchesLevel(entry: ConsoleEntry, levels: readonly string[] | undefined): boolean {
  if (!levels || levels.length === 0) return true;
  if (entry.kind === 'pageerror') {
    // Page errors are treated as `error` for filtering purposes.
    return levels.includes('error');
  }
  return entry.level !== undefined && levels.includes(entry.level);
}

function matchesPattern(entry: ConsoleEntry, pattern: RegExp | null): boolean {
  if (!pattern) return true;
  return pattern.test(entry.text);
}

function safeRegex(input: string | undefined): RegExp | null {
  if (!input) return null;
  try {
    return new RegExp(input);
  } catch {
    return null;
  }
}

export const electronConsoleTail: ToolHandler<
  ElectronConsoleTailInput,
  ElectronConsoleTailOutput
> = async (rawInput, ctx) => {
  const input = ElectronConsoleTailInputSchema.parse(rawInput);
  const session = ctx.sessions.get(input.sessionId);
  const buffer = session.consoleBuffer;
  const levels = input.level;
  const pattern = safeRegex(input.pattern);

  const filtered = buffer.entries.filter(
    (entry) => matchesLevel(entry, levels) && matchesPattern(entry, pattern),
  );
  const limit = input.limit;
  const sliceStart = Math.max(0, filtered.length - limit);
  const selected = filtered.slice(sliceStart);

  if (input.drain) {
    // Remove exactly the emitted entries from the underlying buffer,
    // preserving anything that didn't match the filter.
    const toDrop = new Set(selected);
    buffer.entries = buffer.entries.filter((entry) => !toDrop.has(entry));
  }

  ctx.sessions.touch(session);

  return ElectronConsoleTailOutputSchema.parse({
    ok: true,
    sessionId: session.id,
    entries: selected,
    dropped: buffer.dropped,
    bufferSize: buffer.entries.length,
  });
};
