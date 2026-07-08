// State
let allPorts = [];
let filteredPorts = [];
let autoRefreshInterval = null;
let autoRefreshEnabled = false;

// DOM Elements
const scanBtn = document.getElementById('scanBtn');
const autoRefreshBtn = document.getElementById('autoRefreshBtn');
const searchInput = document.getElementById('searchInput');
const protocolFilter = document.getElementById('protocolFilter');
const stateFilter = document.getElementById('stateFilter');
const sortBy = document.getElementById('sortBy');
const loadingIndicator = document.getElementById('loadingIndicator');
const portGrid = document.getElementById('portGrid');
const portCount = document.getElementById('portCount');
const lastScan = document.getElementById('lastScan');

// Event Listeners
scanBtn.addEventListener('click', scanPorts);
autoRefreshBtn.addEventListener('click', toggleAutoRefresh);
searchInput.addEventListener('input', applyFilters);
protocolFilter.addEventListener('change', applyFilters);
stateFilter.addEventListener('change', applyFilters);
sortBy.addEventListener('change', applyFilters);

// Scan for ports
async function scanPorts() {
  showLoading(true);
  scanBtn.disabled = true;

  try {
    const result = await window.electronAPI.scanPorts();

    if (result.success) {
      allPorts = result.ports;
      applyFilters();
      updateLastScanTime();
    } else {
      console.error('Scan error:', result.error);
      showError(result.error);
    }
  } catch (error) {
    console.error('Error:', error);
    showError(error.message);
  } finally {
    showLoading(false);
    scanBtn.disabled = false;
  }
}

// Apply filters and sorting
function applyFilters() {
  const searchTerm = searchInput.value.toLowerCase();
  const protocol = protocolFilter.value;
  const state = stateFilter.value;
  const sort = sortBy.value;

  filteredPorts = allPorts.filter(port => {
    // Search filter
    if (searchTerm) {
      const searchMatch =
        port.localPort.toString().includes(searchTerm) ||
        port.processName.toLowerCase().includes(searchTerm) ||
        port.localAddress.toLowerCase().includes(searchTerm) ||
        (port.foreignAddress && port.foreignAddress.toLowerCase().includes(searchTerm));
      if (!searchMatch) return false;
    }

    // Protocol filter
    if (protocol !== 'all' && port.protocol !== protocol) return false;

    // State filter
    if (state !== 'all') {
      const stateMap = {
        'LISTENING': 'LISTENING',
        'ESTABLISHED': 'ESTABLISHED',
        'TIME_WAIT': 'TIME_WAIT',
        'CLOSE_WAIT': 'CLOSE_WAIT'
      };
      if (port.state !== state && port.state !== stateMap[state]) return false;
    }

    return true;
  });

  // Sort
  filteredPorts.sort((a, b) => {
    switch (sort) {
      case 'port':
        return a.localPort - b.localPort;
      case 'process':
        return a.processName.localeCompare(b.processName);
      case 'state':
        return a.state.localeCompare(b.state);
      default:
        return 0;
    }
  });

  renderPorts();
  updatePortCount();
}

// Render port cards
function renderPorts() {
  portGrid.innerHTML = '';

  if (filteredPorts.length === 0) {
    portGrid.innerHTML = `
      <div class="no-results">
        <h3>No ports found</h3>
        <p>Click "Scan Ports" to detect active connections</p>
      </div>
    `;
    return;
  }

  for (const port of filteredPorts) {
    const card = createPortCard(port);
    portGrid.appendChild(card);
  }
}

// Create a single port card
function createPortCard(port) {
  const card = document.createElement('div');
  card.className = 'port-card';

  const stateClass = getStateClass(port.state);
  const memoryMB = port.memory ? formatBytes(port.memory) : '-';

  card.innerHTML = `
    <div class="port-card-header">
      <span class="port-number">${port.localPort}</span>
      <span class="protocol-badge ${port.protocol.toLowerCase()}">${port.protocol}</span>
    </div>
    <div class="port-card-details">
      <div class="detail-row">
        <span class="detail-label">State</span>
        <span class="state-badge ${stateClass}">${port.state}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Process</span>
        <span class="detail-value process-name">${escapeHtml(port.processName)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">PID</span>
        <span class="detail-value pid">${port.pid || '-'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Local Address</span>
        <span class="detail-value">${port.localAddress}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Remote</span>
        <span class="detail-value">${port.foreignAddress || '-'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Memory</span>
        <span class="detail-value">${memoryMB}</span>
      </div>
      ${port.processPath ? `
      <div class="detail-row">
        <span class="detail-label">Path</span>
        <span class="detail-value" title="${escapeHtml(port.processPath)}">${truncatePath(port.processPath)}</span>
      </div>
      ` : ''}
    </div>
    <div class="port-card-actions">
      ${port.processPath ? `<button class="action-btn open-btn" data-path="${escapeHtml(port.processPath)}" title="Open file location">Open Location</button>` : ''}
      <button class="action-btn kill-btn" data-pid="${port.pid}" data-process="${escapeHtml(port.processName)}" title="Kill this process">Kill</button>
    </div>
  `;

  // Add event listeners
  const killBtn = card.querySelector('.kill-btn');
  killBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pid = parseInt(killBtn.dataset.pid, 10);
    const processName = killBtn.dataset.process;
    await handleKillProcess(pid, processName);
  });

  const openBtn = card.querySelector('.open-btn');
  if (openBtn) {
    openBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const filePath = openBtn.dataset.path;
      await handleOpenLocation(filePath);
    });
  }

  return card;
}

// Get CSS class for state
function getStateClass(state) {
  const stateMap = {
    'LISTENING': 'listening',
    'ESTABLISHED': 'established',
    'TIME_WAIT': 'time_wait',
    'CLOSE_WAIT': 'close_wait'
  };
  return stateMap[state] || 'default';
}

// Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Truncate file path
function truncatePath(path) {
  if (!path) return '-';
  if (path.length <= 30) return path;
  return '...' + path.slice(-27);
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Show/hide loading
function showLoading(show) {
  if (show) {
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

// Update port count
function updatePortCount() {
  portCount.textContent = `${filteredPorts.length} ports detected`;
}

// Update last scan time
function updateLastScanTime() {
  const now = new Date();
  const time = now.toLocaleTimeString();
  lastScan.textContent = `Last scan: ${time}`;
}

// Toggle auto refresh
function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;

  if (autoRefreshEnabled) {
    autoRefreshBtn.classList.add('active');
    autoRefreshBtn.textContent = 'Auto Refresh: On';
    autoRefreshInterval = setInterval(scanPorts, 10000);
  } else {
    autoRefreshBtn.classList.remove('active');
    autoRefreshBtn.textContent = 'Auto Refresh: Off';
    clearInterval(autoRefreshInterval);
    autoRefreshInterval = null;
  }
}

// Handle kill process
async function handleKillProcess(pid, processName) {
  const confirmed = confirm(`Are you sure you want to kill "${processName}" (PID: ${pid})?\n\nThis may cause data loss if the application has unsaved changes.`);
  if (!confirmed) return;

  try {
    const result = await window.electronAPI.killProcess(pid);
    if (result.success) {
      showToast(`Process ${processName} (PID: ${pid}) terminated`, 'success');
      // Refresh ports after a short delay
      setTimeout(scanPorts, 500);
    } else {
      showToast(`Failed to kill process: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

// Handle open app location
async function handleOpenLocation(filePath) {
  try {
    const result = await window.electronAPI.openAppLocation(filePath);
    if (!result.success) {
      showToast(`Could not open: ${result.error}`, 'error');
    }
  } catch (error) {
    showToast(`Error: ${error.message}`, 'error');
  }
}

// Show toast notification
function showToast(message, type = 'info') {
  // Remove existing toast
  const existingToast = document.querySelector('.toast');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger animation
  setTimeout(() => toast.classList.add('show'), 10);

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Show error
function showError(message) {
  portGrid.innerHTML = `
    <div class="no-results">
      <h3>Error</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// Initial scan on load
document.addEventListener('DOMContentLoaded', () => {
  scanPorts();
});