import { describe, expect, it } from 'vitest';
import { isKillablePid } from '../src/main/kill';

describe('isKillablePid', () => {
  it('accepts ordinary process ids', () => {
    expect(isKillablePid(1234)).toBe(true);
    expect(isKillablePid(5)).toBe(true);
  });

  it('rejects system PIDs 0 and 4', () => {
    expect(isKillablePid(0)).toBe(false);
    expect(isKillablePid(4)).toBe(false);
  });

  it('rejects non-integer and injection-shaped input', () => {
    expect(isKillablePid('1234; shutdown /s')).toBe(false);
    expect(isKillablePid('1234')).toBe(false);
    expect(isKillablePid(12.5)).toBe(false);
    expect(isKillablePid(-1)).toBe(false);
    expect(isKillablePid(null)).toBe(false);
    expect(isKillablePid(undefined)).toBe(false);
    expect(isKillablePid(Number.NaN)).toBe(false);
    expect(isKillablePid(2 ** 40)).toBe(false);
  });
});
