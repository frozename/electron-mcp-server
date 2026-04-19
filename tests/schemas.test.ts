import { describe, expect, test } from 'vitest';
import {
  ElectronAccessibilitySnapshotInputSchema,
  ElectronClickInputSchema,
  ElectronConsoleTailInputSchema,
  ElectronLaunchInputSchema,
  ElectronWaitForSelectorInputSchema,
  ElectronWaitForWindowInputSchema,
} from '../src/schemas/index.js';

describe('ElectronLaunchInputSchema', () => {
  test('accepts a minimal launch', () => {
    const result = ElectronLaunchInputSchema.parse({ executablePath: '/bin/electron' });
    expect(result.executablePath).toBe('/bin/electron');
    expect(result.args).toEqual([]);
  });

  test('rejects empty executable path', () => {
    expect(() => ElectronLaunchInputSchema.parse({ executablePath: '' })).toThrow();
  });

  test('rejects overly large timeout', () => {
    expect(() =>
      ElectronLaunchInputSchema.parse({ executablePath: '/x', timeout: 999_999 }),
    ).toThrow();
  });
});

describe('ElectronClickInputSchema', () => {
  test('applies defaults', () => {
    const parsed = ElectronClickInputSchema.parse({
      sessionId: 'sess_1',
      selector: '#x',
    });
    expect(parsed.button).toBe('left');
    expect(parsed.clickCount).toBe(1);
    expect(parsed.force).toBe(false);
  });
});

describe('ElectronWaitForWindowInputSchema', () => {
  test('accepts urlPattern only', () => {
    const parsed = ElectronWaitForWindowInputSchema.parse({
      sessionId: 'sess_1',
      urlPattern: '/login',
    });
    expect(parsed.urlPattern).toBe('/login');
  });
});

describe('ElectronWaitForSelectorInputSchema', () => {
  test('defaults state to visible', () => {
    const parsed = ElectronWaitForSelectorInputSchema.parse({
      sessionId: 'sess_1',
      selector: '#login',
    });
    expect(parsed.state).toBe('visible');
  });

  test('rejects unknown state', () => {
    expect(() =>
      ElectronWaitForSelectorInputSchema.parse({
        sessionId: 'sess_1',
        selector: '#x',
        state: 'enabled',
      }),
    ).toThrow();
  });
});

describe('ElectronAccessibilitySnapshotInputSchema', () => {
  test('defaults interestingOnly to true', () => {
    const parsed = ElectronAccessibilitySnapshotInputSchema.parse({
      sessionId: 'sess_1',
    });
    expect(parsed.interestingOnly).toBe(true);
  });
});

describe('ElectronConsoleTailInputSchema', () => {
  test('defaults limit and drain', () => {
    const parsed = ElectronConsoleTailInputSchema.parse({ sessionId: 'sess_1' });
    expect(parsed.limit).toBe(100);
    expect(parsed.drain).toBe(false);
  });

  test('limits reject over-sized requests', () => {
    expect(() =>
      ElectronConsoleTailInputSchema.parse({ sessionId: 'sess_1', limit: 99999 }),
    ).toThrow();
  });
});
