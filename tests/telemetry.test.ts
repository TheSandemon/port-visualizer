import { describe, expect, it } from 'vitest';
import { TelemetryEngine } from '../src/main/telemetry';
import type { PortEntry, ScanDiff } from '../src/shared/types';

function port(id: string, remoteAddress: string | null = null): PortEntry {
  return {
    id,
    protocol: 'TCP',
    localAddress: '127.0.0.1',
    localPort: 8000,
    remoteAddress,
    remotePort: remoteAddress ? 443 : null,
    state: remoteAddress ? 'ESTABLISHED' : 'LISTENING',
    pid: 42,
    processName: 'server',
    processPath: null,
    memory: 0,
    parentPid: null,
    commandLine: null,
    serviceLabel: null,
    exposure: 'loopback',
    attributes: {},
    annotations: [],
  };
}

function withOwner(entry: PortEntry, pid: number): PortEntry {
  return { ...entry, id: `${entry.id}-${pid}`, pid, processName: `process-${pid}` };
}

function diff(partial: Partial<ScanDiff>): ScanDiff {
  return { addedIds: [], removedIds: [], changedIds: [], removed: [], ...partial };
}

describe('TelemetryEngine', () => {
  it('tracks socket lifetime and aggregates connections per local endpoint', () => {
    const engine = new TelemetryEngine();
    const first = [port('listener'), port('peer-a', '10.0.0.1'), port('peer-b', '10.0.0.2')];
    const opened = engine.apply(first, diff({ addedIds: first.map((item) => item.id) }), 1000);

    expect(opened).toHaveLength(3);
    expect(first[0].telemetry?.localConnectionCount).toBe(2);
    expect(first[0].telemetry?.remotePeerCount).toBe(2);
    expect(first[0].telemetry?.ownerCount).toBe(1);
    expect(first[0].telemetry?.endpointOpenCount).toBe(1);

    const second = [port('listener')];
    const closed = engine.apply(
      second,
      diff({ removedIds: ['peer-a', 'peer-b'], removed: [first[1], first[2]] }),
      4000,
    );
    expect(second[0].telemetry?.firstSeenAt).toBe(1000);
    expect(second[0].telemetry?.observedScans).toBe(2);
    expect(second[0].telemetry?.stateChangeCount).toBe(1);
    expect(closed[0].payload.lifetimeMs).toBe(3000);
  });

  it('reports observed connection rate, owner changes, and endpoint collisions', () => {
    const engine = new TelemetryEngine();
    const listener = withOwner(port('listener'), 10);
    engine.apply([listener], diff({ addedIds: [listener.id] }), 1000);

    const nextListener = withOwner(port('listener'), 20);
    const peer = withOwner(port('peer', '10.0.0.2'), 21);
    const events = engine.apply(
      [nextListener, peer],
      diff({
        addedIds: [nextListener.id, peer.id],
        removedIds: [listener.id],
        removed: [listener],
      }),
      61_000,
    );

    expect(nextListener.telemetry?.connectionRatePerMinute).toBe(1);
    expect(nextListener.telemetry?.ownerCount).toBe(2);
    expect(nextListener.telemetry?.hasCollision).toBe(true);
    expect(events.some((event) => event.type === 'port.owner-changed')).toBe(true);
  });
});
