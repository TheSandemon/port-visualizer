import { describe, expect, it } from 'vitest';
import { parsePowershellScan } from '../src/main/scanner';

const PS_JSON = JSON.stringify({
  tcp: [
    {
      LocalAddress: '0.0.0.0',
      LocalPort: 135,
      RemoteAddress: '0.0.0.0',
      RemotePort: 0,
      State: 'Listen',
      OwningProcess: 1104,
    },
    {
      LocalAddress: '::',
      LocalPort: 135,
      RemoteAddress: '::',
      RemotePort: 0,
      State: 2,
      OwningProcess: 1104,
    },
    {
      LocalAddress: '192.168.1.5',
      LocalPort: 54321,
      RemoteAddress: '142.250.72.14',
      RemotePort: 443,
      State: 'Established',
      OwningProcess: 8812,
    },
    { LocalAddress: '0.0.0.0', LocalPort: 0, State: 'Bound', OwningProcess: 999 },
  ],
  udp: [{ LocalAddress: '0.0.0.0', LocalPort: 5353, OwningProcess: 3220 }],
  procs: [
    { Id: 1104, ProcessName: 'svchost', Path: null, WorkingSet64: 10240 },
    { Id: 8812, ProcessName: 'chrome', Path: 'C:\\chrome.exe', WorkingSet64: 999999 },
  ],
  cim: [{ ProcessId: 8812, ParentProcessId: 100, CommandLine: 'chrome.exe --flag' }],
});

describe('parsePowershellScan', () => {
  const entries = parsePowershellScan(PS_JSON);

  it('parses TCP + UDP entries and skips port 0', () => {
    expect(entries).toHaveLength(4);
  });

  it('normalizes both string and numeric TCP states', () => {
    const port135 = entries.filter((e) => e.localPort === 135);
    expect(port135).toHaveLength(2);
    expect(port135.every((e) => e.state === 'LISTENING')).toBe(true);
  });

  it('joins process and CIM metadata', () => {
    const chrome = entries.find((e) => e.pid === 8812);
    expect(chrome?.processName).toBe('chrome');
    expect(chrome?.parentPid).toBe(100);
    expect(chrome?.commandLine).toBe('chrome.exe --flag');
    expect(chrome?.remoteAddress).toBe('142.250.72.14');
  });

  it('handles single-object (non-array) JSON from ConvertTo-Json', () => {
    const single = JSON.stringify({
      tcp: {
        LocalAddress: '127.0.0.1',
        LocalPort: 8080,
        State: 'Listen',
        OwningProcess: 42,
      },
      udp: null,
      procs: { Id: 42, ProcessName: 'app', Path: null, WorkingSet64: 1 },
      cim: null,
    });
    const result = parsePowershellScan(single);
    expect(result).toHaveLength(1);
    expect(result[0].localPort).toBe(8080);
    expect(result[0].serviceLabel).toBe('http-alt');
  });
});
