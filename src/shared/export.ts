import type { PortEntry } from './types';

const CSV_COLUMNS: Array<[header: string, get: (p: PortEntry) => string | number | null]> = [
  ['Protocol', (p) => p.protocol],
  ['Local Address', (p) => p.localAddress],
  ['Local Port', (p) => p.localPort],
  ['Remote Address', (p) => p.remoteAddress],
  ['Remote Port', (p) => p.remotePort],
  ['State', (p) => p.state],
  ['PID', (p) => p.pid],
  ['Process', (p) => p.processName],
  ['Path', (p) => p.processPath],
  ['Service', (p) => p.serviceLabel],
  ['Publisher', (p) => publisherText(p)],
  ['Signature', (p) => p.signature?.status ?? 'checking'],
  ['Firewall', (p) => p.firewall?.disposition ?? 'checking'],
  ['Parent Chain', (p) => (p.ancestors ?? []).map((a) => `${a.name} (${a.pid})`).join(' < ')],
  ['Command Line', (p) => p.commandLine],
];

/** Publisher text used everywhere a signature is displayed or exported. */
export function publisherText(port: PortEntry): string {
  const signature = port.signature;
  if (!signature) return 'Checking…';
  if (signature.publisher) return signature.publisher;
  switch (signature.status) {
    case 'unsigned':
      return 'Unsigned';
    case 'tampered':
      return 'Signature does not match binary';
    case 'untrusted':
      return 'Untrusted signer';
    default:
      return 'Unknown publisher';
  }
}

export function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize port entries to CSV. Pure — unit tested. */
export function portsToCsv(ports: PortEntry[]): string {
  const header = CSV_COLUMNS.map(([h]) => h).join(',');
  const rows = ports.map((p) => CSV_COLUMNS.map(([, get]) => csvEscape(get(p))).join(','));
  return [header, ...rows].join('\r\n') + '\r\n';
}

export function portsToJson(ports: PortEntry[]): string {
  return JSON.stringify(ports, null, 2);
}
