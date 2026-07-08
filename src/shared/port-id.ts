import type { Protocol } from './types';

/**
 * Stable identity for a socket. Includes local address, pid and remote so
 * multiple sockets on the same port (IPv4+IPv6, several ESTABLISHED
 * connections) are never collapsed into one entry.
 */
export function portEntryId(args: {
  protocol: Protocol;
  localAddress: string;
  localPort: number;
  pid: number;
  remoteAddress: string | null;
  remotePort: number | null;
}): string {
  const remote =
    args.remoteAddress !== null ? `${args.remoteAddress}:${args.remotePort ?? 0}` : '-';
  return `${args.protocol}|${args.localAddress}|${args.localPort}|${args.pid}|${remote}`;
}
