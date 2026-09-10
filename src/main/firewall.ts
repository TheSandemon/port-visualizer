import { execFile } from 'child_process';
import { promisify } from 'util';
import type { FirewallStatus, OkResult, Protocol } from '../shared/types';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const QUERY_TIMEOUT_MS = 30000;
const ELEVATED_TIMEOUT_MS = 60000;

/** Prefix that identifies rules this app created, so it only removes its own. */
export const RULE_PREFIX = 'Port Visualizer block';

/**
 * Enabled inbound rules joined to their port filters. Rules without a local
 * port (program or service rules) cannot be attributed to a port and are
 * deliberately excluded rather than guessed at.
 */
const PS_QUERY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$filters = @{}
foreach ($filter in Get-NetFirewallPortFilter) {
  $filters[$filter.InstanceID] = $filter
}
$rows = foreach ($rule in Get-NetFirewallRule -Direction Inbound -Enabled True) {
  $filter = $filters[$rule.InstanceID]
  if ($null -eq $filter) { continue }
  [pscustomobject]@{
    Name = $rule.DisplayName
    Action = $rule.Action.ToString()
    Protocol = $filter.Protocol
    LocalPort = @($filter.LocalPort) -join ','
  }
}
@($rows) | ConvertTo-Json -Compress -Depth 3
`.trim();

interface PsRuleRow {
  Name?: string | null;
  Action?: string | null;
  Protocol?: string | null;
  LocalPort?: string | null;
}

export function firewallKey(protocol: Protocol, port: number): string {
  return `${protocol}:${port}`;
}

/**
 * Expand a Windows LocalPort field into concrete port numbers. Handles the
 * comma list and `4000-4010` range forms; `Any`, `RPC` and friends match no
 * specific port and are dropped.
 */
function expandPorts(raw: string | null | undefined): number[] {
  if (!raw) return [];
  const ports: number[] = [];
  for (const part of raw.split(',')) {
    const token = part.trim();
    if (!token) continue;
    const range = /^(\d{1,5})-(\d{1,5})$/.exec(token);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      // Wide ranges are almost always "allow ephemeral"; expanding them would
      // dominate the map without telling the user anything port-specific.
      if (end >= start && end - start <= 1024) {
        for (let port = start; port <= end; port += 1) ports.push(port);
      }
      continue;
    }
    if (/^\d{1,5}$/.test(token)) ports.push(Number(token));
  }
  return ports.filter((port) => port > 0 && port <= 65535);
}

function protocolsFor(raw: string | null | undefined): Protocol[] {
  const value = (raw ?? '').trim().toUpperCase();
  if (value === 'TCP') return ['TCP'];
  if (value === 'UDP') return ['UDP'];
  if (value === 'ANY' || value === '') return ['TCP', 'UDP'];
  return [];
}

/** Build the port -> disposition map from the rule query. Pure — unit tested. */
export function parseFirewallRules(json: string): Map<string, FirewallStatus> {
  const statuses = new Map<string, FirewallStatus>();
  if (!json.trim()) return statuses;

  const parsed = JSON.parse(json) as PsRuleRow | PsRuleRow[];
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const checkedAt = Date.now();

  for (const row of rows) {
    const ports = expandPorts(row?.LocalPort);
    if (ports.length === 0) continue;
    const blocking = (row?.Action ?? '').trim().toLowerCase() === 'block';
    const name = row?.Name?.trim() || (blocking ? 'Unnamed block rule' : 'Unnamed allow rule');

    for (const protocol of protocolsFor(row?.Protocol)) {
      for (const port of ports) {
        const key = firewallKey(protocol, port);
        const existing = statuses.get(key);
        if (!existing) {
          statuses.set(key, {
            disposition: blocking ? 'blocked' : 'allowed',
            ruleNames: [name],
            checkedAt,
          });
          continue;
        }
        if (!existing.ruleNames.includes(name)) existing.ruleNames.push(name);
        // A block rule beats any number of allow rules for the same port.
        if (blocking) existing.disposition = 'blocked';
      }
    }
  }

  return statuses;
}

/**
 * Parse `netsh advfirewall firewall show rule` output. Used because
 * Get-NetFirewallPortFilter needs administrator rights, while netsh does not.
 * Pure — unit tested.
 */
export function parseNetshRules(output: string): Map<string, FirewallStatus> {
  const statuses = new Map<string, FirewallStatus>();
  const checkedAt = Date.now();

  let current: Record<string, string> = {};
  const commit = (): void => {
    if (
      Object.keys(current).length === 0 ||
      (current.Enabled ?? '').toLowerCase() !== 'yes'
    ) {
      current = {};
      return;
    }
    const ports = expandPorts(current.LocalPort);
    const blocking = (current.Action ?? '').toLowerCase() === 'block';
    const name = current['Rule Name'] || (blocking ? 'Unnamed block rule' : 'Unnamed allow rule');

    for (const protocol of protocolsFor(current.Protocol)) {
      for (const port of ports) {
        const key = firewallKey(protocol, port);
        const existing = statuses.get(key);
        if (!existing) {
          statuses.set(key, {
            disposition: blocking ? 'blocked' : 'allowed',
            ruleNames: [name],
            checkedAt,
          });
          continue;
        }
        if (!existing.ruleNames.includes(name)) existing.ruleNames.push(name);
        if (blocking) existing.disposition = 'blocked';
      }
    }
    current = {};
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('---')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const field = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    // Each block restarts at its rule name, so the previous one is complete.
    if (field === 'Rule Name') commit();
    current[field] = value;
  }
  commit();

  return statuses;
}

export interface FirewallReadResult {
  statuses: Map<string, FirewallStatus>;
  /** False when no source could be read, so ports must not be called rule-free. */
  available: boolean;
}

/**
 * Read the active inbound rule set. The structured cmdlets are locale
 * independent but need elevation, so netsh is the fallback for the common
 * unelevated case. Ports with no matching rule are resolved by the caller,
 * which knows which ports are actually in use.
 */
export async function readFirewallRules(): Promise<FirewallReadResult> {
  try {
    const { stdout } = await execFileAsync('powershell.exe', [...PS_ARGS, PS_QUERY_SCRIPT], {
      encoding: 'utf8',
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const statuses = parseFirewallRules(stdout);
    if (statuses.size > 0) return { statuses, available: true };
  } catch (error) {
    console.error('[Firewall] Structured rule query failed, falling back to netsh:', error);
  }

  try {
    const { stdout } = await execFileAsync(
      'netsh',
      ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in'],
      {
        encoding: 'utf8',
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const statuses = parseNetshRules(stdout);
    // A localized Windows prints different field labels; reporting "no rule"
    // for every port would be worse than admitting the read did not work.
    if (statuses.size === 0 && stdout.trim().length > 0) {
      console.warn('[Firewall] netsh output produced no parseable rules.');
      return { statuses, available: false };
    }
    return { statuses, available: true };
  } catch (error) {
    console.error('[Firewall] netsh rule query failed:', error);
    return { statuses: new Map(), available: false };
  }
}

export function blockRuleName(protocol: Protocol, port: number): string {
  return `${RULE_PREFIX} ${protocol} ${port}`;
}

function isValidTarget(protocol: unknown, port: unknown): protocol is Protocol {
  return (
    (protocol === 'TCP' || protocol === 'UDP') &&
    typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  );
}

/**
 * Add or remove an inbound block rule for one port. Both paths run elevated
 * through a UAC prompt because firewall changes always require administrator
 * rights; the port is integer-validated before it reaches the command.
 */
export async function setPortBlocked(
  protocol: unknown,
  port: unknown,
  blocked: unknown,
): Promise<OkResult> {
  if (!isValidTarget(protocol, port)) {
    return { success: false, error: 'Invalid firewall target' };
  }
  const name = blockRuleName(protocol, port as number);
  const inner =
    blocked === true
      ? `New-NetFirewallRule -DisplayName '${name}' -Direction Inbound -Action Block -Protocol ${protocol} -LocalPort ${port} -Profile Any`
      : `Get-NetFirewallRule -DisplayName '${name}' | Remove-NetFirewallRule`;

  // -EncodedCommand keeps the inner script intact across the elevation hop
  // without a second round of quote escaping.
  const encoded = Buffer.from(
    `$ErrorActionPreference='Stop'; ${inner}`,
    'utf16le',
  ).toString('base64');
  const script = `$p = Start-Process -FilePath powershell.exe -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}' -Verb RunAs -Wait -WindowStyle Hidden -PassThru; exit $p.ExitCode`;

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: ELEVATED_TIMEOUT_MS,
      windowsHide: true,
    });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Firewall] Rule change failed for ${protocol} ${port}:`, message);
    const cancelled = /canceled|cancelled/i.test(message);
    return { success: false, error: cancelled ? 'Elevation was declined' : message };
  }
}
