import type { JsonValue, PortEntry, PortEvent, PortTelemetry, ScanDiff } from '../shared/types';

interface SeenSocket {
  firstSeenAt: number;
  observedScans: number;
}

interface EndpointAggregate {
  entries: PortEntry[];
  connections: number;
  peers: Set<string>;
  owners: Set<number>;
  states: Set<string>;
  representative: PortEntry;
}

interface EndpointStats {
  lastScan: number;
  openCount: number;
  stateChangeCount: number;
  states: string;
  owners: string;
  timestamp: number;
  ratePerMinute: number;
}

interface ExposureProfile {
  lastScan: number;
  exposures: string;
}

export class TelemetryEngine {
  private readonly seen = new Map<string, SeenSocket>();
  private readonly endpointStats = new Map<string, EndpointStats>();
  private readonly exposureProfiles = new Map<string, ExposureProfile>();
  private sequence = 0;
  private scanNumber = 0;

  hydrateSequence(sequence: number): void {
    if (Number.isSafeInteger(sequence) && sequence > this.sequence) this.sequence = sequence;
  }

  apply(ports: PortEntry[], diff: ScanDiff, timestamp: number): PortEvent[] {
    this.scanNumber += 1;
    const aggregates = aggregateEndpoints(ports);
    const addedConnections = countAddedConnections(ports, diff.addedIds);
    const events = this.lifecycleEvents(ports, diff, timestamp);

    for (const [key, aggregate] of aggregates) {
      const previous = this.endpointStats.get(key);
      const continuous = previous?.lastScan === this.scanNumber - 1;
      const states = [...aggregate.states].sort().join(',');
      const owners = [...aggregate.owners].sort((a, b) => a - b).join(',');
      const elapsed = continuous ? timestamp - previous.timestamp : 0;
      const ratePerMinute =
        continuous && elapsed > 0
          ? (addedConnections.get(key) ?? 0) * (60000 / elapsed)
          : 0;
      const current: EndpointStats = {
        lastScan: this.scanNumber,
        openCount: (previous?.openCount ?? 0) + (continuous ? 0 : 1),
        stateChangeCount:
          (previous?.stateChangeCount ?? 0) + (continuous && previous.states !== states ? 1 : 0),
        states,
        owners,
        timestamp,
        ratePerMinute,
      };

      if (continuous && previous.owners !== owners) {
        events.push(
          this.event('port.owner-changed', aggregate.representative, timestamp, {
            previousPids: previous.owners.split(',').filter(Boolean).map(Number),
            currentPids: [...aggregate.owners].sort((a, b) => a - b),
          }),
        );
      }
      this.endpointStats.set(key, current);

      for (const port of aggregate.entries) {
        const socket = this.seen.get(port.id)!;
        const telemetry: PortTelemetry = {
          firstSeenAt: socket.firstSeenAt,
          lastSeenAt: timestamp,
          observedScans: socket.observedScans,
          localConnectionCount: aggregate.connections,
          remotePeerCount: aggregate.peers.size,
          endpointOpenCount: current.openCount,
          stateChangeCount: current.stateChangeCount,
          ownerCount: aggregate.owners.size,
          hasCollision: aggregate.owners.size > 1,
          connectionRatePerMinute: ratePerMinute,
        };
        port.telemetry = telemetry;
      }
    }

    this.appendExposureEvents(ports, timestamp, events);
    return events;
  }

  private lifecycleEvents(ports: PortEntry[], diff: ScanDiff, timestamp: number): PortEvent[] {
    const events: PortEvent[] = [];
    for (const port of ports) {
      const previous = this.seen.get(port.id);
      this.seen.set(port.id, {
        firstSeenAt: previous?.firstSeenAt ?? timestamp,
        observedScans: (previous?.observedScans ?? 0) + 1,
      });
    }

    const currentById = new Map(ports.map((port) => [port.id, port]));
    for (const id of diff.addedIds) {
      const port = currentById.get(id);
      if (port) events.push(this.event('port.opened', port, timestamp, {}));
    }
    for (const port of diff.removed) {
      const seen = this.seen.get(port.id);
      const payload: Record<string, JsonValue> = seen
        ? { lifetimeMs: Math.max(0, timestamp - seen.firstSeenAt) }
        : {};
      events.push(this.event('port.closed', port, timestamp, payload));
      this.seen.delete(port.id);
    }
    for (const id of diff.changedIds) {
      const port = currentById.get(id);
      if (port) events.push(this.event('port.changed', port, timestamp, { state: port.state }));
    }
    return events;
  }

  private appendExposureEvents(
    ports: PortEntry[],
    timestamp: number,
    events: PortEvent[],
  ): void {
    const profiles = new Map<string, { exposures: Set<string>; representative: PortEntry }>();
    for (const port of ports) {
      const key = `${port.protocol}|${port.localPort}`;
      const profile = profiles.get(key) ?? {
        exposures: new Set<string>(),
        representative: port,
      };
      profile.exposures.add(port.exposure);
      profiles.set(key, profile);
    }
    for (const [key, profile] of profiles) {
      const exposures = [...profile.exposures].sort().join(',');
      const previous = this.exposureProfiles.get(key);
      if (previous?.lastScan === this.scanNumber - 1 && previous.exposures !== exposures) {
        events.push(
          this.event('port.exposure-changed', profile.representative, timestamp, {
            previous: previous.exposures,
            current: exposures,
          }),
        );
      }
      this.exposureProfiles.set(key, { lastScan: this.scanNumber, exposures });
    }
  }

  private event(
    type: PortEvent['type'],
    port: PortEntry,
    timestamp: number,
    payload: Record<string, JsonValue>,
  ): PortEvent {
    this.sequence += 1;
    return {
      schemaVersion: 1,
      sequence: this.sequence,
      timestamp,
      type,
      observationId: port.id,
      port,
      payload,
    };
  }
}

function aggregateEndpoints(ports: PortEntry[]): Map<string, EndpointAggregate> {
  const aggregates = new Map<string, EndpointAggregate>();
  for (const port of ports) {
    const key = localEndpointKey(port);
    const aggregate = aggregates.get(key) ?? {
      entries: [],
      connections: 0,
      peers: new Set<string>(),
      owners: new Set<number>(),
      states: new Set<string>(),
      representative: port,
    };
    aggregate.entries.push(port);
    if (port.state === 'ESTABLISHED') aggregate.connections += 1;
    if (port.remoteAddress) aggregate.peers.add(`${port.remoteAddress}:${port.remotePort ?? 0}`);
    aggregate.owners.add(port.pid);
    aggregate.states.add(port.state);
    aggregates.set(key, aggregate);
  }
  return aggregates;
}

function localEndpointKey(port: PortEntry): string {
  return `${port.protocol}|${port.localAddress}|${port.localPort}`;
}

function countAddedConnections(ports: PortEntry[], addedIds: string[]): Map<string, number> {
  const added = new Set(addedIds);
  const counts = new Map<string, number>();
  for (const port of ports) {
    if (!added.has(port.id) || port.state !== 'ESTABLISHED') continue;
    const key = localEndpointKey(port);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
