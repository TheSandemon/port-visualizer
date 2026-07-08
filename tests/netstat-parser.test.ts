import { describe, expect, it } from 'vitest';
import {
  buildPortEntries,
  parseNetstat,
  splitAddress,
  type ProcessInfo,
} from '../src/main/netstat-parser';

const FIXTURE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1104
  TCP    0.0.0.0:445            0.0.0.0:0              LISTENING       4
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9241
  TCP    192.168.1.5:54321      142.250.72.14:443      ESTABLISHED     8812
  TCP    192.168.1.5:54322      142.250.72.14:443      TIME_WAIT       0
  TCP    [::]:135               [::]:0                 LISTENING       1104
  TCP    [::1]:5432             [::]:0                 LISTENING       6001
  TCP    [fe80::1%5]:49670      [fe80::2%5]:445        ESTABLISHED     4
  UDP    0.0.0.0:5353           *:*                                    3220
  UDP    [::]:5353              *:*                                    3220
  UDP    0.0.0.0:0              *:*                                    1000
  garbage line that should be ignored
  TCP    incomplete
`;

describe('splitAddress', () => {
  it('parses IPv4 addresses', () => {
    expect(splitAddress('0.0.0.0:135')).toEqual({ address: '0.0.0.0', port: 135 });
  });

  it('parses bracketed IPv6 addresses', () => {
    expect(splitAddress('[::]:445')).toEqual({ address: '::', port: 445 });
    expect(splitAddress('[::1]:5432')).toEqual({ address: '::1', port: 5432 });
    expect(splitAddress('[fe80::1%5]:49670')).toEqual({ address: 'fe80::1%5', port: 49670 });
  });

  it('rejects unparseable input', () => {
    expect(splitAddress('*:*')).toBeNull();
    expect(splitAddress('nonsense')).toBeNull();
  });
});

describe('parseNetstat', () => {
  const sockets = parseNetstat(FIXTURE);

  it('parses TCP and UDP entries, skipping port 0 and garbage', () => {
    expect(sockets).toHaveLength(10);
    expect(sockets.filter((s) => s.protocol === 'TCP')).toHaveLength(8);
    expect(sockets.filter((s) => s.protocol === 'UDP')).toHaveLength(2);
  });

  it('keeps IPv4 and IPv6 sockets on the same port distinct', () => {
    const port135 = sockets.filter((s) => s.localPort === 135);
    expect(port135).toHaveLength(2);
    expect(new Set(port135.map((s) => s.localAddress))).toEqual(new Set(['0.0.0.0', '::']));
  });

  it('extracts remote endpoints for established connections', () => {
    const established = sockets.find((s) => s.localPort === 54321);
    expect(established?.remoteAddress).toBe('142.250.72.14');
    expect(established?.remotePort).toBe(443);
    expect(established?.state).toBe('ESTABLISHED');
  });

  it('treats 0.0.0.0:0 remote as no remote', () => {
    const listening = sockets.find((s) => s.localPort === 445);
    expect(listening?.remoteAddress).toBeNull();
  });

  it('marks UDP entries as LISTENING with no remote', () => {
    const udp = sockets.filter((s) => s.protocol === 'UDP');
    expect(udp.every((s) => s.state === 'LISTENING' && s.remoteAddress === null)).toBe(true);
  });
});

describe('buildPortEntries', () => {
  it('joins process info and never collapses distinct sockets', () => {
    const sockets = parseNetstat(FIXTURE);
    const processes = new Map<number, ProcessInfo>([
      [9241, { name: 'node', path: 'C:\\nodejs\\node.exe', memory: 1234, parentPid: 1, commandLine: 'node vite' }],
    ]);
    const entries = buildPortEntries(sockets, processes);

    expect(entries).toHaveLength(10);
    const vite = entries.find((e) => e.localPort === 5173);
    expect(vite?.processName).toBe('node');
    expect(vite?.serviceLabel).toBe('vite dev');
    expect(entries.find((e) => e.pid === 4)?.processName).toBe('System');
    expect(entries.find((e) => e.localPort === 54322)?.processName).toBe('System Idle');
  });

  it('sorts by port then address', () => {
    const entries = buildPortEntries(parseNetstat(FIXTURE), new Map());
    const ports = entries.map((e) => e.localPort);
    expect(ports).toEqual([...ports].sort((a, b) => a - b));
  });
});
