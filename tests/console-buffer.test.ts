import { describe, expect, test } from 'vitest';

import { createConsoleBuffer } from '../src/session/console-buffer.js';
import type { ConsoleEntry } from '../src/schemas/index.js';

function pushEntry(
  buffer: ReturnType<typeof createConsoleBuffer>,
  text: string,
  level: ConsoleEntry['level'] = 'log',
): void {
  buffer.entries.push({
    ts: new Date().toISOString(),
    kind: 'console',
    level,
    text,
  });
  while (buffer.entries.length > buffer.capacity) {
    buffer.entries.shift();
    buffer.dropped += 1;
  }
}

describe('ConsoleBuffer', () => {
  test('retains entries up to capacity', () => {
    const buffer = createConsoleBuffer(3);
    pushEntry(buffer, 'a');
    pushEntry(buffer, 'b');
    pushEntry(buffer, 'c');
    expect(buffer.entries.map((e) => e.text)).toEqual(['a', 'b', 'c']);
    expect(buffer.dropped).toBe(0);
  });

  test('evicts oldest when over capacity and tracks drops', () => {
    const buffer = createConsoleBuffer(2);
    pushEntry(buffer, 'a');
    pushEntry(buffer, 'b');
    pushEntry(buffer, 'c');
    pushEntry(buffer, 'd');
    expect(buffer.entries.map((e) => e.text)).toEqual(['c', 'd']);
    expect(buffer.dropped).toBe(2);
  });

  test('instrumented WeakSet starts empty', () => {
    const buffer = createConsoleBuffer();
    expect(buffer.instrumented).toBeInstanceOf(WeakSet);
  });
});
