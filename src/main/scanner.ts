import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PortEntry, Protocol, ScanResult } from '../shared/types';
import { buildPortEntries, parseNetstat, type ProcessInfo } from './netstat-parser';
import { portEntryId } from '../shared/port-id';
import { lookupServiceLabel } from '../shared/known-ports';
import { withObservationFields } from '../shared/observation';
import { redactCommandLine } from '../shared/redaction';
import { buildAncestors, type AncestorSource } from './process-tree';
import { getCachedSignature } from './signature';

const execFileAsync = promisify(execFile);

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
const SCAN_TIMEOUT_MS = 6000;
const PROCESS_CACHE_TTL_MS = 120000;
const CIM_REFRESH_INTERVAL_MS = 300000;
const STRUCTURED_SCAN_BACKOFF_MS = 300000;

interface CachedProcessInfo {
  info: ProcessInfo;
  expiresAt: number;
}

const processCache = new Map<number, CachedProcessInfo>();
let lastCimRefreshAt = 0;
let cimRefreshInFlight: Promise<void> | null = null;
let structuredScanBackoffUntil = 0;

/**
 * One fast PowerShell invocation gathering sockets and working-set memory.
 * Slow CIM command-line enrichment runs separately and never blocks a scan.
 */
const PS_SCAN_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$tcp = Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess
$udp = Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess
$ownerIds = @($tcp.OwningProcess) + @($udp.OwningProcess) | Sort-Object -Unique
$procs = Get-Process -Id $ownerIds | Select-Object Id,ProcessName,Path,WorkingSet64
@{ tcp = @($tcp); udp = @($udp); procs = @($procs) } | ConvertTo-Json -Compress -Depth 3
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
  Name?: string | null;
  ExecutablePath?: string | null;
  WorkingSetSize?: number | string | null;
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
  const procByPid = new Map<number, PsProcRow>();
  for (const row of procs) {
    if (typeof row.Id === 'number') procByPid.set(row.Id, row);
  }
  const cimByPid = new Map<number, PsCimRow>();
  for (const row of cim) {
    if (typeof row.ProcessId === 'number') cimByPid.set(row.ProcessId, row);
  }

  const map = new Map<number, ProcessInfo>();
  const pids = new Set([...procByPid.keys(), ...cimByPid.keys()]);
  for (const pid of pids) {
    const processRow = procByPid.get(pid);
    const cimRow = cimByPid.get(pid);
    const cimMemory = Number(cimRow?.WorkingSetSize ?? 0);
    map.set(pid, {
      name:
        processRow?.ProcessName || cimRow?.Name?.replace(/\.exe$/i, '') || fallbackProcessName(pid),
      path: processRow?.Path || cimRow?.ExecutablePath || null,
      memory: processRow?.WorkingSet64 || (Number.isFinite(cimMemory) ? cimMemory : 0),
      parentPid: typeof cimRow?.ParentProcessId === 'number' ? cimRow.ParentProcessId : null,
      commandLine: redactCommandLine(cimRow?.CommandLine),
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
    byId.set(
      id,
      withObservationFields({
        id,
        ...args,
        processName: proc?.name ?? fallbackProcessName(args.pid),
        processPath: proc?.path ?? null,
        memory: proc?.memory ?? 0,
        parentPid: proc?.parentPid ?? null,
        commandLine: proc?.commandLine ?? null,
        serviceLabel: lookupServiceLabel(args.localPort),
      }),
    );
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
  const ports = parsePowershellScan(stdout);
  hydrateFromProcessCache(ports);
  rememberPorts(ports);
  scheduleCimRefresh();
  return ports;
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
  const ownerPids = new Set(sockets.map((socket) => socket.pid));

  let processes = new Map<number, ProcessInfo>();
  try {
    const pidList = [...ownerPids].filter(Number.isSafeInteger).join(',');
    const psProcScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ownerIds = @(${pidList})
Get-Process -Id $ownerIds | Select-Object Id,ProcessName,Path,WorkingSet64 | ConvertTo-Json -Compress
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
    const partial = partialStdout(error);
    if (partial.trim()) {
      try {
        const rows = toArray(JSON.parse(partial) as PsProcRow | PsProcRow[]);
        processes = buildProcessMap(rows, []);
      } catch (parseError) {
        console.error('[Scanner] Could not parse partial process metadata:', parseError);
      }
    }
    console.warn(
      `[Scanner] Process metadata query ended early; retained ${processes.size} process records.`,
    );
  }

  if ([...ownerPids].some((pid) => !processes.has(pid))) {
    try {
      const { stdout: tasklistOutput } = await execFileAsync(
        'tasklist.exe',
        ['/FO', 'CSV', '/NH'],
        {
          encoding: 'utf8',
          timeout: 16000,
          maxBuffer: 16 * 1024 * 1024,
          windowsHide: true,
        },
      );
      processes = mergeProcessMaps(processes, parseTasklist(tasklistOutput));
    } catch (error) {
      const partial = partialStdout(error);
      if (partial) processes = mergeProcessMaps(processes, parseTasklist(partial));
      console.error('[Scanner] Tasklist process lookup failed (fallback path):', error);
    }
  }

  processes = mergeCachedProcesses(processes);
  const ports = buildPortEntries(sockets, processes);
  hydrateFromProcessCache(ports);
  rememberPorts(ports);
  scheduleCimRefresh();
  return ports;
}

export function parseTasklist(output: string): Map<number, ProcessInfo> {
  const processes = new Map<number, ProcessInfo>();
  for (const line of output.split(/\r?\n/)) {
    const columns = parseCsvLine(line.trim());
    if (columns.length < 5) continue;
    const pid = Number.parseInt(columns[1], 10);
    if (!Number.isInteger(pid)) continue;
    const memoryKb = Number.parseInt(columns[4].replace(/[^0-9]/g, ''), 10);
    processes.set(pid, {
      name: columns[0].replace(/\.exe$/i, '') || fallbackProcessName(pid),
      path: null,
      memory: Number.isFinite(memoryKb) ? memoryKb * 1024 : 0,
      parentPid: null,
      commandLine: null,
    });
  }
  return processes;
}

function parseCsvLine(line: string): string[] {
  if (!line) return [];
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function partialStdout(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('stdout' in error)) return '';
  return typeof error.stdout === 'string' ? error.stdout : '';
}

function fallbackProcessName(pid: number): string {
  if (pid === 0) return 'System Idle';
  if (pid === 4) return 'System';
  return `Process ${pid}`;
}

function mergeProcessMaps(
  primary: Map<number, ProcessInfo>,
  secondary: Map<number, ProcessInfo>,
): Map<number, ProcessInfo> {
  const merged = new Map(primary);
  for (const [pid, candidate] of secondary) {
    const existing = merged.get(pid);
    if (!existing) {
      merged.set(pid, candidate);
      continue;
    }
    merged.set(pid, {
      name: existing.name || candidate.name,
      path: existing.path || candidate.path,
      memory: existing.memory || candidate.memory,
      parentPid: existing.parentPid ?? candidate.parentPid,
      commandLine: existing.commandLine || candidate.commandLine,
    });
  }
  return merged;
}

function mergeCachedProcesses(processes: Map<number, ProcessInfo>): Map<number, ProcessInfo> {
  const now = Date.now();
  const merged = new Map(processes);
  for (const [pid, cached] of processCache) {
    if (cached.expiresAt <= now) {
      processCache.delete(pid);
    } else if (!merged.has(pid)) {
      merged.set(pid, cached.info);
    }
  }
  return merged;
}

function lookupAncestor(pid: number): AncestorSource | null {
  const cached = processCache.get(pid);
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return { name: cached.info.name, parentPid: cached.info.parentPid };
}

function hydrateFromProcessCache(ports: PortEntry[]): void {
  const now = Date.now();
  for (const port of ports) {
    const cached = processCache.get(port.pid);
    if (cached && cached.expiresAt > now) {
      if (port.processName.startsWith('Process ')) port.processName = cached.info.name;
      if (!port.processPath) port.processPath = cached.info.path;
      if (!port.memory) port.memory = cached.info.memory;
      if (port.parentPid === null) port.parentPid = cached.info.parentPid;
      if (!port.commandLine) port.commandLine = cached.info.commandLine;
    }
    port.ancestors = buildAncestors(port.pid, port.parentPid, lookupAncestor);
    port.signature = port.processPath ? getCachedSignature(port.processPath) : null;
  }
}

function rememberPorts(ports: PortEntry[]): void {
  const expiresAt = Date.now() + PROCESS_CACHE_TTL_MS;
  for (const port of ports) {
    const previous = processCache.get(port.pid)?.info;
    const identifiable = !port.processName.startsWith('Process ');
    if (!identifiable && !previous) continue;
    const sameProcess = !previous || previous.name === port.processName || !identifiable;
    const base = sameProcess ? previous : undefined;
    processCache.set(port.pid, {
      expiresAt,
      info: {
        name: identifiable ? port.processName : (base?.name ?? port.processName),
        path: port.processPath || base?.path || null,
        memory: port.memory || base?.memory || 0,
        parentPid: port.parentPid ?? base?.parentPid ?? null,
        commandLine: port.commandLine || base?.commandLine || null,
      },
    });
  }
}

function scheduleCimRefresh(): void {
  const now = Date.now();
  if (cimRefreshInFlight || now - lastCimRefreshAt < CIM_REFRESH_INTERVAL_MS) return;
  lastCimRefreshAt = now;
  cimRefreshInFlight = (async () => {
    try {
      const script = `
$ErrorActionPreference = 'SilentlyContinue'
Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,Name,ExecutablePath,WorkingSetSize | ConvertTo-Json -Compress
`.trim();
      const { stdout } = await execFileAsync('powershell.exe', [...PS_ARGS, script], {
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
      });
      if (!stdout.trim()) return;
      const rows = toArray(JSON.parse(stdout) as PsCimRow | PsCimRow[]);
      const details = buildProcessMap([], rows);
      const expiresAt = Date.now() + PROCESS_CACHE_TTL_MS;
      for (const [pid, info] of details) processCache.set(pid, { info, expiresAt });
    } catch (error) {
      console.error('[Scanner] Background process enrichment failed:', error);
    } finally {
      cimRefreshInFlight = null;
    }
  })();
}

/**
 * Scan all active ports. Prefers the single structured PowerShell query,
 * falls back to netstat text parsing if PowerShell fails or is blocked.
 */
export async function scanPorts(): Promise<ScanResult> {
  if (Date.now() >= structuredScanBackoffUntil) {
    try {
      const ports = await scanViaPowershell();
      return { ports, timestamp: Date.now(), source: 'powershell' };
    } catch (error) {
      structuredScanBackoffUntil = Date.now() + STRUCTURED_SCAN_BACKOFF_MS;
      console.error('[Scanner] PowerShell scan failed, falling back to netstat:', error);
    }
  }
  const ports = await scanViaNetstat();
  return { ports, timestamp: Date.now(), source: 'netstat' };
}
