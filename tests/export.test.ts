import { describe, expect, it } from 'vitest';
import { csvEscape, portsToCsv } from '../src/shared/export';
import type { PortEntry } from '../src/shared/types';

const sample: PortEntry = {
  id: 'TCP|127.0.0.1|80|100|-',
  protocol: 'TCP',
  localAddress: '127.0.0.1',
  localPort: 80,
  remoteAddress: null,
  remotePort: null,
  state: 'LISTENING',
  pid: 100,
  processName: 'evil, "quoted" name',
  processPath: 'C:\\Program Files\\App\\app.exe',
  memory: 1024,
  parentPid: null,
  commandLine: null,
  serviceLabel: 'http',
};

describe('csvEscape', () => {
  it('passes plain values through', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape(42)).toBe('42');
    expect(csvEscape(null)).toBe('');
  });

  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
  });
});

describe('portsToCsv', () => {
  it('produces a header plus one row per entry with proper escaping', () => {
    const csv = portsToCsv([sample]);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Local Port');
    expect(lines[1]).toContain('"evil, ""quoted"" name"');
    expect(lines[1]).toContain('http');
  });
});
