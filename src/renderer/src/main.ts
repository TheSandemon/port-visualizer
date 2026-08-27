import './styles.css';
import type {
  AppSettings,
  Exposure,
  PortEntry,
  PortEvent,
  PortsUpdate,
  ViewMode,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let allPorts: PortEntry[] = [];
let visiblePorts: PortEntry[] = [];
let settings: AppSettings | null = null;
let lastDiffAdded = new Set<string>();
let lastDiffChanged = new Set<string>();
let history: PortEvent[] = [];
const HISTORY_LIMIT = 500;

// ---------------------------------------------------------------------------
// DOM lookups
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const scanBtn = $<HTMLButtonElement>('scanBtn');
const themeBtn = $<HTMLButtonElement>('themeBtn');
const settingsBtn = $<HTMLButtonElement>('settingsBtn');
const searchInput = $<HTMLInputElement>('searchInput');
const protocolFilter = $<HTMLSelectElement>('protocolFilter');
const stateFilter = $<HTMLSelectElement>('stateFilter');
const exposureFilter = $<HTMLSelectElement>('exposureFilter');
const sortBy = $<HTMLSelectElement>('sortBy');
const autoRefreshToggle = $<HTMLInputElement>('autoRefreshToggle');
const refreshInterval = $<HTMLSelectElement>('refreshInterval');
const viewButtons: Record<ViewMode, HTMLButtonElement> = {
  cards: $<HTMLButtonElement>('viewCards'),
  table: $<HTMLButtonElement>('viewTable'),
  process: $<HTMLButtonElement>('viewProcess'),
};
const cardsView = $('cardsView');
const tableView = $('tableView');
const tableBody = $('tableBody');
const processView = $('processView');
const emptyState = $('emptyState');
const historyPanel = $('historyPanel');
const historyList = $('historyList');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (!bytes) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function stateClass(state: string): string {
  return (
    {
      LISTENING: 'listening',
      ESTABLISHED: 'established',
      TIME_WAIT: 'time-wait',
      CLOSE_WAIT: 'close-wait',
    }[state] ?? 'other'
  );
}

function exposureLabel(exposure: Exposure): string {
  return exposure === 'all-interfaces'
    ? 'All interfaces'
    : exposure === 'lan'
      ? 'LAN address'
      : 'Loopback';
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return '<1s';
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatEndpoint(address: string, port: number | null): string {
  const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
  return port === null ? host : `${host}:${port}`;
}

function annotationText(port: PortEntry): string {
  return port.annotations
    .flatMap((annotation) => Object.values(annotation.values).map(String))
    .join(' ');
}

function watchedPortKey(port: PortEntry): string {
  return `${port.protocol}:${port.localPort}`;
}

function isWatched(port: PortEntry): boolean {
  return settings?.watchedPortKeys.includes(watchedPortKey(port)) ?? false;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  document.querySelector('.toast')?.remove();
  const toast = el('div', `toast toast-${type}`, message);
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

async function copy(text: string, label: string): Promise<void> {
  const result = await window.electronAPI.copyText(text);
  showToast(
    result.success ? `${label} copied` : 'Copy failed',
    result.success ? 'success' : 'error',
  );
}

// ---------------------------------------------------------------------------
// Filtering & sorting
// ---------------------------------------------------------------------------

function computeVisible(): void {
  const term = searchInput.value.trim().toLowerCase();
  const proto = protocolFilter.value;
  const state = stateFilter.value;
  const exposure = exposureFilter.value;

  visiblePorts = allPorts.filter((p) => {
    if (proto !== 'all' && p.protocol !== proto) return false;
    if (state !== 'all' && p.state !== state) return false;
    if (exposure !== 'all' && p.exposure !== exposure) return false;
    if (term) {
      const haystack =
        `${p.localPort} ${p.processName} ${p.localAddress} ${p.remoteAddress ?? ''} ` +
        `${p.serviceLabel ?? ''} ${p.pid} ${p.exposure} ${annotationText(p)}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });

  const sort = sortBy.value;
  visiblePorts.sort((a, b) => {
    switch (sort) {
      case 'process':
        return a.processName.localeCompare(b.processName) || a.localPort - b.localPort;
      case 'state':
        return a.state.localeCompare(b.state) || a.localPort - b.localPort;
      case 'memory':
        return b.memory - a.memory || a.localPort - b.localPort;
      default:
        return a.localPort - b.localPort || a.localAddress.localeCompare(b.localAddress);
    }
  });
}

// ---------------------------------------------------------------------------
// Keyed rendering
// ---------------------------------------------------------------------------

/** Signature of the mutable parts of an entry; unchanged rows are not rebuilt. */
function entrySignature(p: PortEntry): string {
  return `${p.state}|${p.memory}|${p.processName}|${p.remoteAddress}:${p.remotePort}|${p.exposure}|${annotationText(p)}|${p.telemetry?.localConnectionCount ?? 0}|${isWatched(p)}`;
}

/**
 * Reconcile container children against the visible list. Elements are keyed
 * by data-id and reused, so scroll position and CSS animations survive.
 */
function reconcile(
  container: HTMLElement,
  items: PortEntry[],
  build: (p: PortEntry) => HTMLElement,
): void {
  const existing = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (child.dataset.id) existing.set(child.dataset.id, child);
  }

  let cursor: ChildNode | null = container.firstChild;
  for (const item of items) {
    let node = existing.get(item.id);
    if (node && node.dataset.sig !== entrySignature(item)) {
      const fresh = build(item);
      node.replaceWith(fresh);
      node = fresh;
      node.classList.add('flash-changed');
    } else if (!node) {
      node = build(item);
      if (lastDiffAdded.has(item.id)) node.classList.add('flash-new');
    } else if (lastDiffChanged.has(item.id)) {
      node.classList.add('flash-changed');
    }
    existing.delete(item.id);

    if (node !== cursor) container.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }

  for (const leftover of existing.values()) leftover.remove();
}

function buildActions(p: PortEntry): HTMLElement {
  const actions = el('div', 'entry-actions');

  const address = formatEndpoint(p.localAddress, p.localPort);
  const copyBtn = el('button', 'action-btn', 'Address');
  copyBtn.title = 'Copy local address';
  copyBtn.addEventListener('click', () => void copy(address, address));
  actions.appendChild(copyBtn);

  if (p.protocol === 'TCP' && p.state === 'LISTENING') {
    const urlBtn = el('button', 'action-btn', 'Open URL');
    urlBtn.title = 'Open this local listener in the default browser';
    urlBtn.addEventListener('click', async () => {
      const result = await window.electronAPI.openLocalEndpoint(p.id);
      if (!result.success) showToast(`Could not open endpoint: ${result.error}`, 'error');
    });
    actions.appendChild(urlBtn);
  }

  if (p.processPath) {
    const openBtn = el('button', 'action-btn', 'Folder');
    openBtn.title = 'Open file location';
    openBtn.addEventListener('click', async () => {
      const result = await window.electronAPI.openAppLocation(p.processPath!);
      if (!result.success) showToast(`Could not open: ${result.error}`, 'error');
    });
    actions.appendChild(openBtn);
  }

  const watching = isWatched(p);
  const watchBtn = el('button', `action-btn${watching ? ' watched' : ''}`, watching ? 'Watching' : 'Watch');
  watchBtn.title = watching
    ? 'Stop watching this port'
    : 'Notify on lifecycle, owner, and exposure changes';
  watchBtn.addEventListener('click', async () => {
    const watched = new Set(settings?.watchedPortKeys ?? []);
    const key = watchedPortKey(p);
    if (watched.has(key)) watched.delete(key);
    else watched.add(key);
    await patchSettings({ watchedPortKeys: [...watched] });
    render();
  });
  actions.appendChild(watchBtn);

  if (p.pid > 4) {
    const killBtn = el('button', 'action-btn danger', 'Kill');
    killBtn.title = 'Kill this process';
    killBtn.addEventListener('click', () => openKillModal(p));
    actions.appendChild(killBtn);
  }

  return actions;
}

function buildCard(p: PortEntry): HTMLElement {
  const card = el('div', 'port-card');
  card.dataset.id = p.id;
  card.dataset.sig = entrySignature(p);

  const header = el('div', 'card-header');
  const portSpan = el('span', 'port-number', String(p.localPort));
  portSpan.title = 'Click to copy';
  portSpan.addEventListener('click', () => void copy(String(p.localPort), `Port ${p.localPort}`));
  header.appendChild(portSpan);
  if (p.serviceLabel) header.appendChild(el('span', 'service-badge', p.serviceLabel));
  if (isWatched(p)) header.appendChild(el('span', 'watch-badge', 'Watched'));
  if (p.telemetry?.hasCollision) {
    header.appendChild(el('span', 'collision-badge', `${p.telemetry.ownerCount} owners`));
  }
  header.appendChild(
    el('span', `exposure-badge exposure-${p.exposure}`, exposureLabel(p.exposure)),
  );
  header.appendChild(el('span', `protocol-badge ${p.protocol.toLowerCase()}`, p.protocol));
  card.appendChild(header);

  const details = el('div', 'card-details');
  const row = (label: string, value: string, extraClass = '') => {
    const r = el('div', 'detail-row');
    r.appendChild(el('span', 'detail-label', label));
    r.appendChild(el('span', `detail-value ${extraClass}`.trim(), value));
    details.appendChild(r);
  };
  const stateRow = el('div', 'detail-row');
  stateRow.appendChild(el('span', 'detail-label', 'State'));
  stateRow.appendChild(el('span', `state-badge ${stateClass(p.state)}`, p.state));
  details.appendChild(stateRow);
  row('Process', p.processName, 'strong');
  row('PID', String(p.pid));
  row('Local', formatEndpoint(p.localAddress, p.localPort));
  if (p.remoteAddress) row('Remote', formatEndpoint(p.remoteAddress, p.remotePort));
  row('Memory', formatBytes(p.memory));
  if (p.telemetry) {
    row('Observed', formatDuration(p.telemetry.lastSeenAt - p.telemetry.firstSeenAt));
    if (p.telemetry.localConnectionCount > 0) {
      row(
        'Traffic',
        `${p.telemetry.localConnectionCount} connection${p.telemetry.localConnectionCount === 1 ? '' : 's'} · ${p.telemetry.remotePeerCount} peer${p.telemetry.remotePeerCount === 1 ? '' : 's'}`,
      );
    }
    if (p.telemetry.connectionRatePerMinute > 0) {
      row('Rate', `+${p.telemetry.connectionRatePerMinute.toFixed(1)} connections/min`);
    }
    if (p.telemetry.endpointOpenCount > 1) {
      row('Restarts', String(p.telemetry.endpointOpenCount - 1));
    }
    if (p.telemetry.stateChangeCount > 0) {
      row('State changes', String(p.telemetry.stateChangeCount));
    }
  }
  if (p.processPath) {
    const r = el('div', 'detail-row');
    r.appendChild(el('span', 'detail-label', 'Path'));
    const v = el('span', 'detail-value path', p.processPath);
    v.title = p.processPath;
    r.appendChild(v);
    details.appendChild(r);
  }
  card.appendChild(details);
  if (p.annotations.length > 0) {
    const annotations = el('div', 'annotation-list');
    for (const annotation of p.annotations) {
      for (const [key, value] of Object.entries(annotation.values)) {
        const badge = el('span', 'annotation-badge', `${key.split('.').at(-1)}: ${String(value)}`);
        badge.title = `${annotation.source}${annotation.confidence === undefined ? '' : ` · ${Math.round(annotation.confidence * 100)}% confidence`}`;
        annotations.appendChild(badge);
      }
    }
    card.appendChild(annotations);
  }
  card.appendChild(buildActions(p));
  return card;
}

function buildRow(p: PortEntry): HTMLElement {
  const tr = el('tr');
  tr.dataset.id = p.id;
  tr.dataset.sig = entrySignature(p);

  const td = (value: string, cls = ''): HTMLTableCellElement => {
    const cell = el('td', cls, value);
    tr.appendChild(cell);
    return cell;
  };
  const portCell = td(String(p.localPort), 'strong clickable');
  portCell.title = 'Click to copy';
  portCell.addEventListener('click', () => void copy(String(p.localPort), `Port ${p.localPort}`));
  td(p.protocol);
  const stateCell = el('td');
  stateCell.appendChild(el('span', `state-badge ${stateClass(p.state)}`, p.state));
  tr.appendChild(stateCell);
  td(p.processName);
  td(String(p.pid));
  td(p.localAddress);
  td(p.remoteAddress ? formatEndpoint(p.remoteAddress, p.remotePort) : '–');
  td(exposureLabel(p.exposure), `exposure-text exposure-${p.exposure}`);
  td(formatBytes(p.memory));
  td(p.serviceLabel ?? '–');
  const actionCell = el('td', 'row-actions');
  actionCell.appendChild(buildActions(p));
  tr.appendChild(actionCell);
  return tr;
}

function renderProcessView(): void {
  interface Group {
    pid: number;
    name: string;
    path: string | null;
    memory: number;
    entries: PortEntry[];
  }
  const groups = new Map<number, Group>();
  for (const p of visiblePorts) {
    let g = groups.get(p.pid);
    if (!g) {
      g = { pid: p.pid, name: p.processName, path: p.processPath, memory: p.memory, entries: [] };
      groups.set(p.pid, g);
    }
    g.entries.push(p);
  }

  processView.replaceChildren();
  for (const g of Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))) {
    const groupEl = el('div', 'process-group');
    groupEl.dataset.id = `proc-${g.pid}`;

    const head = el('div', 'process-head');
    head.appendChild(el('span', 'process-name', g.name));
    head.appendChild(
      el(
        'span',
        'process-meta',
        `PID ${g.pid} · ${formatBytes(g.memory)} · ${g.entries.length} socket${g.entries.length === 1 ? '' : 's'}`,
      ),
    );
    const sample = g.entries[0];
    head.appendChild(buildActions(sample));
    groupEl.appendChild(head);

    const chips = el('div', 'port-chips');
    for (const p of g.entries) {
      const chip = el(
        'span',
        `port-chip ${stateClass(p.state)} exposure-${p.exposure}${lastDiffAdded.has(p.id) ? ' flash-new' : ''}`,
        `${p.protocol} ${p.localPort}${p.serviceLabel ? ` (${p.serviceLabel})` : ''}`,
      );
      chip.title = `${formatEndpoint(p.localAddress, p.localPort)} — ${p.state}${p.remoteAddress ? ` ⇄ ${formatEndpoint(p.remoteAddress, p.remotePort)}` : ''}`;
      chip.addEventListener('click', () => void copy(String(p.localPort), `Port ${p.localPort}`));
      chips.appendChild(chip);
    }
    groupEl.appendChild(chips);
    processView.appendChild(groupEl);
  }
}

function render(): void {
  computeVisible();

  const mode = settings?.viewMode ?? 'cards';
  cardsView.classList.toggle('hidden', mode !== 'cards');
  tableView.classList.toggle('hidden', mode !== 'table');
  processView.classList.toggle('hidden', mode !== 'process');
  for (const [name, btn] of Object.entries(viewButtons)) {
    btn.classList.toggle('active', name === mode);
    btn.setAttribute('aria-selected', String(name === mode));
  }

  emptyState.classList.toggle('hidden', visiblePorts.length > 0);

  if (mode === 'cards') reconcile(cardsView, visiblePorts, buildCard);
  else if (mode === 'table') reconcile(tableBody, visiblePorts, buildRow);
  else renderProcessView();

  updateFooter();
  updateTelemetryHeader();
}

function updateFooter(): void {
  $('statTotal').textContent = `${visiblePorts.length} sockets`;
  $('statListening').textContent =
    `${visiblePorts.filter((p) => p.state === 'LISTENING').length} listening`;
  $('statEstablished').textContent =
    `${visiblePorts.filter((p) => p.state === 'ESTABLISHED').length} established`;
  $('statProcesses').textContent = `${new Set(visiblePorts.map((p) => p.pid)).size} processes`;
}

function updateTelemetryHeader(): void {
  const listening = allPorts.filter((p) => p.state === 'LISTENING').length;
  const exposed = allPorts.filter((p) => p.exposure === 'all-interfaces').length;
  const connections = allPorts.filter((p) => p.state === 'ESTABLISHED').length;
  $('metricListening').textContent = String(listening);
  $('metricConnections').textContent = String(connections);
  $('metricExposed').textContent = String(exposed);
  $('metricChanges').textContent = String(
    history.filter((event) => Date.now() - event.timestamp < 300_000).length,
  );
  renderSignalRail();
}

function renderSignalRail(): void {
  const rail = $('signalRail');
  rail.replaceChildren();
  const recent = history.slice(0, 42).reverse();
  if (recent.length === 0) {
    rail.appendChild(el('span', 'signal-empty', 'Waiting for the first lifecycle event'));
    return;
  }
  for (const event of recent) {
    const mark = el('span', `signal-mark ${event.type.replace('port.', '')}`);
    mark.style.height = `${event.type === 'port.changed' ? 48 : event.type === 'port.closed' ? 66 : 84}%`;
    mark.title = `${new Date(event.timestamp).toLocaleTimeString()} · ${event.type.replace('port.', '')} · ${event.port.protocol} ${event.port.localPort} · ${event.port.processName}`;
    rail.appendChild(mark);
  }
}

// ---------------------------------------------------------------------------
// History panel
// ---------------------------------------------------------------------------

function recordHistory(update: PortsUpdate): void {
  const knownSequences = new Set(history.map((event) => event.sequence));
  for (const event of [...update.events].reverse()) {
    if (!knownSequences.has(event.sequence)) history.unshift(event);
  }
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  if (!historyPanel.classList.contains('hidden')) renderHistory();
}

function renderHistory(): void {
  historyList.replaceChildren();
  if (history.length === 0) {
    historyList.appendChild(
      el('li', 'history-empty', 'No port changes observed yet this session.'),
    );
    return;
  }
  for (const event of history) {
    const kind = event.type.replace('port.', '');
    const li = el('li', `history-item ${kind}`);
    const time = new Date(event.timestamp).toLocaleTimeString();
    li.appendChild(el('span', 'history-time', time));
    const symbol =
      kind === 'opened'
        ? '＋'
        : kind === 'closed'
          ? '−'
          : kind === 'owner-changed'
            ? '↻'
            : kind === 'exposure-changed'
              ? '◉'
              : '•';
    li.appendChild(el('span', `history-kind ${kind}`, symbol));
    li.appendChild(
      el(
        'span',
        'history-text',
        `${event.port.protocol} ${event.port.localPort} — ${event.port.processName} (${event.port.state})`,
      ),
    );
    historyList.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Kill modal
// ---------------------------------------------------------------------------

const modalOverlay = $('modalOverlay');
const killTreeCheck = $<HTMLInputElement>('killTreeCheck');
let killTarget: PortEntry | null = null;
let killElevated = false;

function openKillModal(p: PortEntry): void {
  killTarget = p;
  killElevated = false;
  killTreeCheck.checked = false;
  $('modalTitle').textContent = `Kill ${p.processName}?`;
  $('modalBody').textContent =
    `PID ${p.pid} owns ${p.protocol} port ${p.localPort}. ` +
    'Force-killing may lose unsaved data in that application.';
  $('modalConfirm').textContent = 'Kill';
  modalOverlay.classList.remove('hidden');
  $('modalConfirm').focus();
}

function closeKillModal(): void {
  modalOverlay.classList.add('hidden');
  killTarget = null;
}

async function confirmKill(): Promise<void> {
  if (!killTarget) return;
  const { pid, processName } = killTarget;
  const tree = killTreeCheck.checked;

  const result = killElevated
    ? await window.electronAPI.killProcessElevated(pid, tree)
    : await window.electronAPI.killProcess(pid, tree);

  if (result.success) {
    closeKillModal();
    showToast(`${processName} (PID ${pid}) terminated`, 'success');
    setTimeout(() => void scan(), 600);
  } else if (result.needsElevation && !killElevated) {
    killElevated = true;
    $('modalTitle').textContent = 'Administrator rights required';
    $('modalBody').textContent =
      `Killing ${processName} (PID ${pid}) was denied. Retry with elevation? ` +
      'Windows will show a UAC prompt.';
    $('modalConfirm').textContent = 'Retry as Admin';
  } else {
    closeKillModal();
    showToast(`Kill failed: ${result.error}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

let scanning = false;

async function scan(): Promise<void> {
  if (scanning) return;
  scanning = true;
  scanBtn.disabled = true;
  scanBtn.classList.add('scanning');
  try {
    const result = await window.electronAPI.scanNow();
    if (!result.success) showToast(`Scan failed: ${result.error}`, 'error');
    // Successful results arrive via the onPortsUpdated push, not this return.
  } catch (error) {
    showToast(`Scan failed: ${error instanceof Error ? error.message : error}`, 'error');
  } finally {
    scanning = false;
    scanBtn.disabled = false;
    scanBtn.classList.remove('scanning');
  }
}

function applyUpdate(update: PortsUpdate): void {
  allPorts = update.ports;
  lastDiffAdded = new Set(update.diff.addedIds);
  lastDiffChanged = new Set(update.diff.changedIds);
  recordHistory(update);
  render();
  $('lastScan').textContent = `Last scan: ${new Date(update.timestamp).toLocaleTimeString()}`;
  $('scanSource').textContent = update.source === 'netstat' ? 'source: netstat (fallback)' : '';
  $('packStatus').textContent =
    `${update.knowledgePacks.length} knowledge pack${update.knowledgePacks.length === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Settings wiring
// ---------------------------------------------------------------------------

async function patchSettings(patch: Partial<AppSettings>): Promise<void> {
  settings = await window.electronAPI.setSettings(patch);
  syncSettingsUi();
}

function syncSettingsUi(): void {
  if (!settings) return;
  autoRefreshToggle.checked = settings.autoRefresh;
  refreshInterval.value = String(settings.refreshIntervalMs);
  document.documentElement.dataset.theme = settings.theme;
  $<HTMLInputElement>('settingNotify').checked = settings.notifyNewListeners;
  $<HTMLInputElement>('settingTray').checked = settings.minimizeToTray;
  $<HTMLInputElement>('settingKnowledge').checked = settings.enableKnowledgePacks;
}

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

scanBtn.addEventListener('click', () => void scan());
searchInput.addEventListener('input', render);
protocolFilter.addEventListener('change', render);
stateFilter.addEventListener('change', render);
exposureFilter.addEventListener('change', render);
sortBy.addEventListener('change', render);

for (const [name, btn] of Object.entries(viewButtons) as [ViewMode, HTMLButtonElement][]) {
  btn.addEventListener('click', () => void patchSettings({ viewMode: name }).then(render));
}

themeBtn.addEventListener('click', () => {
  const current = settings?.theme ?? 'system';
  const next = current === 'system' ? 'dark' : current === 'dark' ? 'light' : 'system';
  void patchSettings({ theme: next }).then(() => showToast(`Theme: ${next}`, 'info'));
});

autoRefreshToggle.addEventListener(
  'change',
  () => void patchSettings({ autoRefresh: autoRefreshToggle.checked }),
);
refreshInterval.addEventListener(
  'change',
  () => void patchSettings({ refreshIntervalMs: Number(refreshInterval.value) }),
);

$('exportCsvBtn').addEventListener('click', () => void exportVisible('csv'));
$('exportJsonBtn').addEventListener('click', () => void exportVisible('json'));

async function exportVisible(format: 'csv' | 'json'): Promise<void> {
  if (visiblePorts.length === 0) {
    showToast('Nothing to export', 'error');
    return;
  }
  const result = await window.electronAPI.exportData({
    format,
    ids: visiblePorts.map((p) => p.id),
  });
  if (result.success) showToast(`Exported ${visiblePorts.length} rows`, 'success');
  else if (result.error !== 'Cancelled') showToast(`Export failed: ${result.error}`, 'error');
}

$('historyBtn').addEventListener('click', () => {
  historyPanel.classList.toggle('hidden');
  if (!historyPanel.classList.contains('hidden')) renderHistory();
});
$('historyCloseBtn').addEventListener('click', () => historyPanel.classList.add('hidden'));

$('modalCancel').addEventListener('click', closeKillModal);
$('modalConfirm').addEventListener('click', () => void confirmKill());
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeKillModal();
});

const settingsOverlay = $('settingsOverlay');
settingsBtn.addEventListener('click', () => settingsOverlay.classList.remove('hidden'));
$('settingsClose').addEventListener('click', () => settingsOverlay.classList.add('hidden'));
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
});
$<HTMLInputElement>('settingNotify').addEventListener(
  'change',
  (e) => void patchSettings({ notifyNewListeners: (e.target as HTMLInputElement).checked }),
);
$<HTMLInputElement>('settingTray').addEventListener(
  'change',
  (e) => void patchSettings({ minimizeToTray: (e.target as HTMLInputElement).checked }),
);
$<HTMLInputElement>('settingKnowledge').addEventListener(
  'change',
  (e) => void patchSettings({ enableKnowledgePacks: (e.target as HTMLInputElement).checked }),
);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!modalOverlay.classList.contains('hidden')) closeKillModal();
    else if (!settingsOverlay.classList.contains('hidden')) settingsOverlay.classList.add('hidden');
    else if (document.activeElement === searchInput) {
      searchInput.value = '';
      searchInput.blur();
      render();
    }
    return;
  }
  const typing = document.activeElement instanceof HTMLInputElement;
  if ((e.ctrlKey && e.key.toLowerCase() === 'r') || e.key === 'F5') {
    e.preventDefault();
    void scan();
  } else if (e.key === '/' && !typing) {
    e.preventDefault();
    searchInput.focus();
  } else if (!typing && ['1', '2', '3'].includes(e.key)) {
    const mode: ViewMode = e.key === '1' ? 'cards' : e.key === '2' ? 'table' : 'process';
    void patchSettings({ viewMode: mode }).then(render);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const unsubscribe = window.electronAPI.onPortsUpdated(applyUpdate);
window.electronAPI.onScanError((message) => showToast(`Scan error: ${message}`, 'error'));
window.addEventListener('beforeunload', unsubscribe);

void (async () => {
  settings = await window.electronAPI.getSettings();
  history = (await window.electronAPI.getRecentEvents(HISTORY_LIMIT)).reverse();
  syncSettingsUi();
  render();
  await scan();
})();
