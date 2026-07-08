const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const portScanner = require('./port-scanner');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Enable logging
console.log('[Main] Application starting...');

function createWindow() {
  console.log('[Main] Creating main window');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1e1e2e',
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[Main] Window shown');
  });

  mainWindow.on('closed', () => {
    console.log('[Main] Window closed');
    mainWindow = null;
  });
}

// IPC handler for scanning ports
ipcMain.handle('scan-ports', async () => {
  console.log('[Main] IPC: scan-ports called');
  try {
    const ports = await portScanner.scanPorts();
    console.log(`[Main] Found ${ports.length} ports`);
    return { success: true, ports };
  } catch (error) {
    console.error('[Main] Error scanning ports:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler for killing a process by PID
ipcMain.handle('kill-process', async (event, pid) => {
  console.log(`[Main] IPC: kill-process called for PID ${pid}`);
  try {
    const { stdout, stderr } = await execPromise(`taskkill /PID ${pid} /F`, { encoding: 'utf8' });
    console.log(`[Main] Process ${pid} killed successfully`);
    return { success: true, message: 'Process terminated successfully' };
  } catch (error) {
    console.error(`[Main] Error killing process ${pid}:`, error.message);
    return { success: false, error: error.message };
  }
});

// IPC handler for opening file location in Explorer
ipcMain.handle('open-app-location', async (event, filePath) => {
  console.log(`[Main] IPC: open-app-location called for ${filePath}`);
  try {
    if (filePath && filePath.trim() !== '') {
      // Open the folder containing the executable
      shell.showItemInFolder(filePath);
      return { success: true, message: 'Folder opened' };
    } else {
      return { success: false, error: 'No file path available' };
    }
  } catch (error) {
    console.error('[Main] Error opening location:', error.message);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  console.log('[Main] App ready');
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  console.log('[Main] All windows closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Main] Unhandled rejection:', reason);
});