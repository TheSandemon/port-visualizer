import type { PortEntry, Protocol } from '../shared/types';
import { portEntryId } from '../shared/port-id';
import { lookupServiceLabel } from '../shared/known-ports';

interface RawSocket {
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  remoteAddress: string | null;
  remotePort: number | null;
  state: string;
  pid: number;
}

/**
 * Split a netstat address like "0.0.0.0:135", "[::]:445" or
 * "192.168.1.5:54321" into address + port. Returns null for unparseable input.
 */
export function splitAddress(addr: string): { address: string; port: number } | null {
  const idx = addr.lastIndexOf(':');
  if (idx <= 0) return null;
  let address = addr.slice(0, idx);
  const port = Number.parseInt(addr.slice(idx + 1), 10);
  if (!Number.isInteger(port)) return null;
  // Strip brackets from IPv6 addresses: [::1] -> ::1
  if (address.startsWith('[') && address.endsWith(']')) {
    address = address.slice(1, -1);
  }
  return { address, port };
}

/**
 * Parse `netstat -ano` output into raw socket entries.
 * Pure function — unit tested against fixture output.
 */
export function parseNetstat(output: string): RawSocket[] {
  const sockets: RawSocket[] = [];

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const protocol = parts[0]?.toUpperCase();

    if (protocol === 'TCP' && parts.length >= 5) {
      const local = splitAddress(parts[1]);
      const remote = splitAddress(parts[2]);
      const pid = Number.parseInt(parts[4], 10);
      if (!local || local.port === 0 || !Number.isInteger(pid)) continue;

      const hasRemote = remote !== null && !(remote.address === '0.0.0.0' && remote.port === 0);
      sockets.push({
        protocol: 'TCP',
        localAddress: local.address,
        localPort: local.port,
        remoteAddress: hasRemote ? remote.address : null,
        remotePort: hasRemote ? remote.port : null,
        state: parts[3] || 'UNKNOWN',
        pid,
      });
    } else if (protocol === 'UDP' && parts.length >= 4) {
      const local = splitAddress(parts[1]);
      const pid = Number.parseInt(parts[3], 10);
      if (!local || local.port === 0 || !Number.isInteger(pid)) continue;

      sockets.push({
        protocol: 'UDP',
        localAddress: local.address,
        localPort: local.port,
        remoteAddress: null,
        remotePort: null,
        state: 'LISTENING',
        pid,
      });
    }
  }

  return sockets;
}

export interface ProcessInfo {
  name: string;
  path: string | null;
  memory: number;
  parentPid: number | null;
  commandLine: string | null;
}

/**
 * Join raw sockets with process details into full PortEntry objects.
 * Keeps every distinct socket (no lossy dedup) but drops exact duplicates,
 * which netstat emits for some UDP multihome bindings.
 */
export function buildPortEntries(
  sockets: RawSocket[],
  processes: Map<number, ProcessInfo>,
): PortEntry[] {
  const byId = new Map<string, PortEntry>();

  for (const s of sockets) {
    const id = portEntryId(s);
    if (byId.has(id)) continue;

    const proc = processes.get(s.pid);
    byId.set(id, {
      id,
      protocol: s.protocol,
      localAddress: s.localAddress,
      localPort: s.localPort,
      remoteAddress: s.remoteAddress,
      remotePort: s.remotePort,
      state: s.state,
      pid: s.pid,
      processName: proc?.name ?? (s.pid === 0 ? 'System Idle' : s.pid === 4 ? 'System' : 'Unknown'),
      processPath: proc?.path ?? null,
      memory: proc?.memory ?? 0,
      parentPid: proc?.parentPid ?? null,
      commandLine: proc?.commandLine ?? null,
      serviceLabel: lookupServiceLabel(s.localPort),
    });
  }

  return Array.from(byId.values()).sort(
    (a, b) => a.localPort - b.localPort || a.localAddress.localeCompare(b.localAddress),
  );
}
