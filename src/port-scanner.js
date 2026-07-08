const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

/**
 * Scans all active ports on the system
 * @returns {Promise<Array>} Array of port objects with detailed info
 */
async function scanPorts() {
  console.log('[PortScanner] Starting port scan...');

  // Get basic port info from netstat
  const netstatOutput = await runNetstat();
  const basicPorts = parseNetstat(netstatOutput);

  console.log(`[PortScanner] Found ${basicPorts.length} basic port entries`);

  // Get process details via PowerShell
  const processDetails = await getProcessDetails();

  // Combine the data
  const ports = combineData(basicPorts, processDetails);

  console.log(`[PortScanner] Final port count: ${ports.length}`);
  return ports;
}

/**
 * Run netstat command to get port information
 */
async function runNetstat() {
  try {
    // Use -ano to get all connections with PID
    const { stdout } = await execPromise('netstat -ano', { encoding: 'utf8' });
    return stdout;
  } catch (error) {
    console.error('[PortScanner] netstat error:', error.message);
    throw new Error('Failed to run netstat: ' + error.message);
  }
}

/**
 * Parse netstat output into structured data
 */
function parseNetstat(output) {
  const lines = output.split('\n');
  const ports = [];

  // Skip header line and process each line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse TCP lines: Protocol  Local Address  Foreign Address  State  PID
    // Parse UDP lines: Protocol  Local Address  PID
    const parts = line.split(/\s+/);

    if (parts.length < 2) continue;

    const protocol = parts[0].toUpperCase();

    if (protocol === 'TCP') {
      if (parts.length >= 5) {
        const localAddress = parts[1];
        const foreignAddress = parts[2];
        const state = parts[3];
        const pid = parseInt(parts[4], 10);

        const localParts = localAddress.split(':');
        const localIP = localParts.slice(0, -1).join(':') || '0.0.0.0';
        const localPort = parseInt(localParts[localParts.length - 1], 10);

        // Skip system ports 0
        if (localPort === 0) continue;

        ports.push({
          protocol: 'TCP',
          localAddress: localIP,
          localPort: localPort,
          foreignAddress: foreignAddress !== '*:*' ? foreignAddress : null,
          state: state || 'UNKNOWN',
          pid: pid
        });
      }
    } else if (protocol === 'UDP') {
      if (parts.length >= 4) {
        const localAddress = parts[1];
        const pid = parseInt(parts[3], 10);

        const localParts = localAddress.split(':');
        const localIP = localParts.slice(0, -1).join(':') || '0.0.0.0';
        const localPort = parseInt(localParts[localParts.length - 1], 10);

        if (localPort === 0) continue;

        ports.push({
          protocol: 'UDP',
          localAddress: localIP,
          localPort: localPort,
          foreignAddress: null,
          state: 'LISTENING',
          pid: pid
        });
      }
    }
  }

  return ports;
}

/**
 * Get detailed process information using PowerShell
 */
async function getProcessDetails() {
  try {
    // Use a more efficient command with a timeout
    const psCommand = `powershell -Command "Get-Process | Select-Object Id, ProcessName, Path, WorkingSet64, StartTime | ConvertTo-Json -Compress"`;

    const { stdout } = await execPromise(psCommand, {
      encoding: 'utf8',
      timeout: 5000 // 5 second timeout
    });

    if (!stdout || stdout.trim() === '') {
      return {};
    }

    const processes = JSON.parse(stdout);

    // Normalize to array
    const processArray = Array.isArray(processes) ? processes : [processes];

    const details = {};
    for (const proc of processArray) {
      if (proc && proc.Id) {
        details[proc.Id] = {
          name: proc.ProcessName || 'Unknown',
          path: proc.Path || null,
          memory: proc.WorkingSet64 || 0,
          startTime: proc.StartTime || null
        };
      }
    }

    return details;
  } catch (error) {
    console.error('[PortScanner] PowerShell error:', error.message);
    return {};
  }
}

/**
 * Combine netstat data with process details
 */
function combineData(basicPorts, processDetails) {
  // Use a Map to deduplicate ports by port+protocol
  const portMap = new Map();

  for (const port of basicPorts) {
    const key = `${port.localPort}-${port.protocol}`;

    if (!portMap.has(key)) {
      const pid = port.pid;
      const procInfo = processDetails[pid] || {};

      portMap.set(key, {
        id: key,
        protocol: port.protocol,
        localPort: port.localPort,
        localAddress: port.localAddress,
        foreignAddress: port.foreignAddress,
        state: port.state,
        pid: pid,
        processName: procInfo.name || 'Unknown',
        processPath: procInfo.path || null,
        memory: procInfo.memory || 0,
        startTime: procInfo.startTime || null
      });
    }
  }

  // Convert to array and sort by port number
  return Array.from(portMap.values()).sort((a, b) => a.localPort - b.localPort);
}

module.exports = { scanPorts };