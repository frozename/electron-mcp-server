import type { ElectronApplication, Page } from 'playwright';

import type { ConsoleEntry } from '../schemas/index.js';
import type { ConsoleBuffer, Session } from './types.js';

const DEFAULT_CAPACITY = 500;

export function createConsoleBuffer(capacity = DEFAULT_CAPACITY): ConsoleBuffer {
  return {
    capacity,
    entries: [],
    dropped: 0,
    instrumented: new WeakSet<Page>(),
  };
}

function push(buffer: ConsoleBuffer, entry: ConsoleEntry): void {
  buffer.entries.push(entry);
  while (buffer.entries.length > buffer.capacity) {
    buffer.entries.shift();
    buffer.dropped += 1;
  }
}

function windowIndex(app: ElectronApplication, page: Page): number | undefined {
  const i = app.windows().indexOf(page);
  return i >= 0 ? i : undefined;
}

/**
 * Attach `console` + `pageerror` listeners to a single page, keyed into the
 * session buffer. Safe to call repeatedly — pages already instrumented are
 * tracked via a `WeakSet` so we don't double-subscribe.
 */
export function instrumentPage(session: Session, page: Page): void {
  const buffer = session.consoleBuffer;
  if (buffer.instrumented.has(page)) return;
  buffer.instrumented.add(page);

  page.on('console', (msg) => {
    const entry: ConsoleEntry = {
      ts: new Date().toISOString(),
      kind: 'console',
      level: msg.type() as ConsoleEntry['level'],
      text: msg.text(),
    };
    const idx = windowIndex(session.app, page);
    if (idx !== undefined) entry.windowIndex = idx;
    const url = page.url();
    if (url) entry.url = url;
    push(buffer, entry);
  });

  page.on('pageerror', (err) => {
    const entry: ConsoleEntry = {
      ts: new Date().toISOString(),
      kind: 'pageerror',
      text: err.message,
    };
    const idx = windowIndex(session.app, page);
    if (idx !== undefined) entry.windowIndex = idx;
    const url = page.url();
    if (url) entry.url = url;
    push(buffer, entry);
  });
}

/**
 * Wire listeners for every current window plus any window the app opens
 * later. Attach in `register()` immediately after the Session is created.
 */
export function instrumentSession(session: Session): void {
  for (const page of session.app.windows()) {
    instrumentPage(session, page);
  }
  session.app.on('window', (page: Page) => {
    instrumentPage(session, page);
  });
}
