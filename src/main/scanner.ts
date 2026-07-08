import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PortEntry, Protocol, ScanResult } from '../shared/types';
import { buildPortEntries, parseNetstat, type ProcessInfo } from './netstat-parser';
import { portEntryId } from '../shared/port-id';
import { lookupServiceLabel } from '../shared/known-ports';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const SCAN_TIMEOUT_MS = 15000;

/**
 * One PowerShell invocation gathering TCP connections, UDP endpoints,
 * process info and command lines, returned as a single JSON document.
 * StartTime is intentionally not queried — it throws for elevated processes.
 */
const PS_SCAN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$tcp = Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess
$udp = Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess
$procs = Get-Process | Select-Object Id,ProcessName,Path,WorkingSet64
$cim = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine
@{ tcp = @($tcp); udp = @($udp); procs = @($procs); cim = @($cim) } | ConvertTo-Json -Compress -Depth 3
`.trim();

/** Get-NetTCPConnection state names -> netstat-style display states. */
const TCP_STATE_MAP: Record<string, string> = {
  Listen: 'LISTENING',
  Established: 'ESTABLISHED',
  TimeWait: 'TIME_WAIT',
  CloseWait: 'CLOSE_WAIT',
  SynSent: 'SYN_SENT',
  SynReceived: 'SYN_RECEIVED',
  FinWait1: 'FIN_WAIT_1',
  FinWait2: 'FIN_WAIT_2',
  LastAck: 'LAST_ACK',
  Closing: 'CLOSING',
  Closed: 'CLOSED',
  Bound: 'BOUND',
  DeleteTCB: 'DELETE_TCB',
};

interface PsTcpRow {
  LocalAddress?: string;
  LocalPort?: number;
  RemoteAddress?: string;
  RemotePort?: number;
  State?: number | string;
  OwningProcess?: number;
}
interface PsUdpRow {
  LocalAddress?: string;
  LocalPort?: number;
  OwningProcess?: number;
}
interface PsProcRow {
  Id?: number;
  ProcessName?: string;
  Path?: string | null;
  WorkingSet64?: number;
}
interface PsCimRow {
  ProcessId?: number;
  ParentProcessId?: number;
  CommandLine?: string | null;
}

function normalizeTcpState(state: number | string | undefined): string {
  if (typeof state === 'string') return TCP_STATE_MAP[state] ?? state.toUpperCase();
  // ConvertTo-Json can serialize the enum as its numeric value depending on
  // PS version; the numeric mapping mirrors the TcpState enum order.
  const numeric: Record<number, string> = {
    1: 'CLOSED',
    2: 'LISTENING',
    3: 'SYN_SENT',
    4: 'SYN_RECEIVED',
    5: 'ESTABLISHED',
    6: 'FIN_WAIT_1',
    7: 'FIN_WAIT_2',
    8: 'CLOSE_WAIT',
    9: 'CLOSING',
    10: 'LAST_ACK',
    11: 'TIME_WAIT',
    12: 'DELETE_TCB',
    100: 'BOUND',
  };
  return state !== undefined ? (numeric[state] ?? `STATE_${state}`) : 'UNKNOWN';
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildProcessMap(procs: PsProcRow[], cim: PsCimRow[]): Map<number, ProcessInfo> {
  const cimByPid = new Map<number, PsCimRow>();
  for (const row of cim) {
    if (typeof row.ProcessId === 'number') cimByPid.set(row.ProcessId, row);
  }

  const map = new Map<number, ProcessInfo>();
  for (const p of procs) {
    if (typeof p.Id !== 'number') continue;
    const cimRow = cimByPid.get(p.Id);
    map.set(p.Id, {
      name: p.ProcessName || 'Unknown',
      path: p.Path || null,
      memory: p.WorkingSet64 || 0,
      parentPid: typeof cimRow?.ParentProcessId === 'number' ? cimRow.ParentProcessId : null,
      commandLine: cimRow?.CommandLine || null,
    });
  }
  return map;
}

function isRealRemote(addr: string | undefined, port: number | undefined): boolean {
  if (!addr) return false;
  return !(addr === '0.0.0.0' || addr === '::') || (port ?? 0) !== 0;
}

/** Parse the JSON document produced by PS_SCAN_SCRIPT. Pure — unit tested. */
export function parsePowershellScan(json: string): PortEntry[] {
  const doc = JSON.parse(json) as {
    tcp?: PsTcpRow | PsTcpRow[];
    udp?: PsUdpRow | PsUdpRow[];
    procs?: PsProcRow | PsProcRow[];
    cim?: PsCimRow | PsCimRow[];
  };

  const processes = buildProcessMap(toArray(doc.procs), toArray(doc.cim));
  const byId = new Map<string, PortEntry>();

  const push = (args: {
    protocol: Protocol;
    localAddress: string;
    localPort: number;
    remoteAddress: string | null;
    remotePort: number | null;
    state: string;
    pid: number;
  }) => {
    const id = portEntryId(args);
    if (byId.has(id)) return;
    const proc = processes.get(args.pid);
    byId.set(id, {
      id,
      ...args,
      processName:
        proc?.name ?? (args.pid === 0 ? 'System Idle' : args.pid === 4 ? 'System' : 'Unknown'),
      processPath: proc?.path ?? null,
      memory: proc?.memory ?? 0,
      parentPid: proc?.parentPid ?? null,
      commandLine: proc?.commandLine ?? null,
      serviceLabel: lookupServiceLabel(args.localPort),
    });
  };

  for (const row of toArray(doc.tcp)) {
    if (typeof row.LocalPort !== 'number' || row.LocalPort === 0) continue;
    const hasRemote = isRealRemote(row.RemoteAddress, row.RemotePort);
    push({
      protocol: 'TCP',
      localAddress: row.LocalAddress || '0.0.0.0',
      localPort: row.LocalPort,
      remoteAddress: hasRemote ? (row.RemoteAddress ?? null) : null,
      remotePort: hasRemote ? (row.RemotePort ?? null) : null,
      state: normalizeTcpState(row.State),
      pid: row.OwningProcess ?? 0,
    });
  }

  for (const row of toArray(doc.udp)) {
    if (typeof row.LocalPort !== 'number' || row.LocalPort === 0) continue;
    push({
      protocol: 'UDP',
      localAddress: row.LocalAddress || '0.0.0.0',
      localPort: row.LocalPort,
      remoteAddress: null,
      remotePort: null,
      state: 'LISTENING',
      pid: row.OwningProcess ?? 0,
    });
  }

  return Array.from(byId.values()).sort(
    (a, b) => a.localPort - b.localPort || a.localAddress.localeCompare(b.localAddress),
  );
}

async function scanViaPowershell(): Promise<PortEntry[]> {
  const { stdout } = await execFileAsync('powershell.exe', [...PS_ARGS, PS_SCAN_SCRIPT], {
    encoding: 'utf8',
    timeout: SCAN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (!stdout.trim()) throw new Error('PowerShell scan produced no output');
  return parsePowershellScan(stdout);
}

/** Fallback path: netstat for sockets, PowerShell only for process info. */
async function scanViaNetstat(): Promise<PortEntry[]> {
  const { stdout } = await execFileAsync('netstat', ['-ano'], {
    encoding: 'utf8',
    timeout: SCAN_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  const sockets = parseNetstat(stdout);

  let processes = new Map<number, ProcessInfo>();
  try {
    const psProcScript = `
$ErrorActionPreference = 'SilentlyContinue'
Get-Process | Select-Object Id,ProcessName,Path,WorkingSet64 | ConvertTo-Json -Compress
`.trim();
    const { stdout: procJson } = await execFileAsync('powershell.exe', [...PS_ARGS, psProcScript], {
      encoding: 'utf8',
      timeout: 8000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    if (procJson.trim()) {
      const rows = toArray(JSON.parse(procJson) as PsProcRow | PsProcRow[]);
      processes = buildProcessMap(rows, []);
    }
  } catch (error) {
    console.error('[Scanner] Process detail lookup failed (fallback path):', error);
  }

  return buildPortEntries(sockets, processes);
}

/**
 * Scan all active ports. Prefers the single structured PowerShell query,
 * falls back to netstat text parsing if PowerShell fails or is blocked.
 */
export async function scanPorts(): Promise<ScanResult> {
  try {
    const ports = await scanViaPowershell();
    return { ports, timestamp: Date.now(), source: 'powershell' };
  } catch (error) {
    console.error('[Scanner] PowerShell scan failed, falling back to netstat:', error);
    const ports = await scanViaNetstat();
    return { ports, timestamp: Date.now(), source: 'netstat' };
  }
}
