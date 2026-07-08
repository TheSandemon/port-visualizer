import { describe, expect, it } from 'vitest';
import { diffScans } from '../src/main/diff';
import type { PortEntry } from '../src/shared/types';

function entry(id: string, state = 'LISTENING'): PortEntry {
  return {
    id,
    protocol: 'TCP',
    localAddress: '127.0.0.1',
    localPort: 80,
    remoteAddress: null,
    remotePort: null,
    state,
    pid: 100,
    processName: 'test',
    processPath: null,
    memory: 0,
    parentPid: null,
    commandLine: null,
    serviceLabel: null,
  };
}

describe('diffScans', () => {
  it('reports added, removed and state-changed entries', () => {
    const prev = [entry('a'), entry('b', 'ESTABLISHED'), entry('c')];
    const next = [entry('b', 'TIME_WAIT'), entry('c'), entry('d')];

    const diff = diffScans(prev, next);
    expect(diff.addedIds).toEqual(['d']);
    expect(diff.removedIds).toEqual(['a']);
    expect(diff.changedIds).toEqual(['b']);
    expect(diff.removed.map((p) => p.id)).toEqual(['a']);
  });

  it('handles the first scan (everything added)', () => {
    const diff = diffScans([], [entry('a'), entry('b')]);
    expect(diff.addedIds).toEqual(['a', 'b']);
    expect(diff.removedIds).toEqual([]);
    expect(diff.changedIds).toEqual([]);
  });

  it('is empty for identical scans', () => {
    const scan = [entry('a'), entry('b')];
    const diff = diffScans(scan, scan);
    expect(diff.addedIds).toEqual([]);
    expect(diff.removedIds).toEqual([]);
    expect(diff.changedIds).toEqual([]);
  });
});
