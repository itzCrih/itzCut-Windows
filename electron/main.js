const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { Readable } = require('stream');
const FFmpegManager = require('./ffmpeg-manager');
const Transcoder = require('./transcoder');
const AutoUpdater = require('./updater');

// Optimization flags for stripped Windows 10/11 editions and low RAM usage
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

// Register custom privileged scheme for secure local video streaming
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'itzcut-media',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

let mainWindow = null;
let splashWindow = null;
let ffmpegManager = null;
let transcoder = null;
let autoUpdater = null;

function createSplashScreen() {
  const iconPath = path.join(__dirname, 'assets/icon.ico');

  splashWindow = new BrowserWindow({
    width: 480,
    height: 310,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    show: true,
    backgroundColor: '#07090e',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow(onReady = null) {
  const iconPath = path.join(__dirname, 'assets/icon.ico');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#07090e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
    },
  });

  // Securely intercept any external link or popup and open in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('https:') || targetUrl.startsWith('http:')) {
      shell.openExternal(targetUrl);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (targetUrl.startsWith('https:') || targetUrl.startsWith('http:')) {
        shell.openExternal(targetUrl);
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (onReady) {
      onReady();
    } else {
      mainWindow.show();
      mainWindow.focus();

      // Initialize AutoUpdater with mainWindow
      autoUpdater = new AutoUpdater(mainWindow);
      setTimeout(() => {
        if (autoUpdater) {
          autoUpdater.checkForUpdates(false);
        }
      }, 3500);
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL(devServerUrl).catch(() => {
      const indexPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(indexPath)) {
        mainWindow.loadFile(indexPath);
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window:state-changed', { maximized: true });
  });
  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window:state-changed', { maximized: false });
  });
  mainWindow.on('minimize', () => {
    mainWindow.webContents.send('app:background', true);
  });
  mainWindow.on('restore', () => {
    mainWindow.webContents.send('app:background', false);
  });
}

app.whenReady().then(async () => {
  const splashStartTime = Date.now();
  createSplashScreen();

  // Ultra-robust Range streaming protocol handler for smooth scrubbing and infinite play without freezing
  protocol.handle('itzcut-media', async (request) => {
    try {
      const rawPath = request.url.replace(/^itzcut-media:\/\/local\//, '');
      const decodedPath = decodeURIComponent(rawPath);

      if (!fs.existsSync(decodedPath)) {
        return new Response('File not found', { status: 404 });
      }

      const stat = fs.statSync(decodedPath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      const mimeTypes = {
        '.mp4': 'video/mp4',
        '.m4v': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/mp4',
        '.mov': 'video/mp4',
        '.avi': 'video/x-msvideo',
        '.wmv': 'video/x-ms-wmv',
        '.flv': 'video/x-flv',
        '.ts': 'video/mp2t',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.wma': 'audio/x-ms-wma',
        '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff',
      };
      const ext = path.extname(decodedPath).toLowerCase();
      const contentType = mimeTypes[ext] || 'video/mp4';

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const nodeStream = fs.createReadStream(decodedPath, { start, end });
        const webStream = Readable.toWeb(nodeStream);

        return new Response(webStream, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Content-Type': contentType,
          },
        });
      } else {
        const nodeStream = fs.createReadStream(decodedPath);
        const webStream = Readable.toWeb(nodeStream);

        return new Response(webStream, {
          status: 200,
          headers: {
            'Content-Length': fileSize.toString(),
            'Accept-Ranges': 'bytes',
            'Content-Type': contentType,
          },
        });
      }
    } catch (err) {
      return new Response(err.message, { status: 500 });
    }
  });

  const appDataPath = app.getPath('userData');
  ffmpegManager = new FFmpegManager(appDataPath);
  transcoder = new Transcoder(ffmpegManager);

  // Run FFmpeg & hardware detection in background while splash is shown
  const detectPromise = ffmpegManager.detect().catch((err) => {
    console.error('FFmpeg detection error:', err);
  });

  createWindow(async () => {
    await detectPromise;
    const elapsed = Date.now() - splashStartTime;
    const minSplashDuration = 500; // Snappy 0.5s splash screen for ultra-fast startup feel
    const remainingDelay = Math.max(0, minSplashDuration - elapsed);

    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }

      // Initialize AutoUpdater with mainWindow
      autoUpdater = new AutoUpdater(mainWindow);
      setTimeout(() => {
        if (autoUpdater) {
          autoUpdater.checkForUpdates(false);
        }
      }, 3500);
    }, remainingDelay);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC: Window controls
ipcMain.on('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

// IPC: Safe External URL Opener
ipcMain.handle('shell:openExternal', async (event, targetUrl) => {
  if (targetUrl && (targetUrl.startsWith('https://') || targetUrl.startsWith('http://'))) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});

ipcMain.handle('dialog:openFile', async (event, options = {}) => {
  const defaultFilters = [
    { name: 'Media Files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus', 'wma', 'aiff', 'gif'] },
    { name: 'Video Files', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'm4v', 'ts', '3gp', 'gif'] },
    { name: 'Audio Files', extensions: ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus', 'wma', 'aiff'] },
  ];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || 'Select a media file to convert or trim',
    properties: [options.multi ? 'multiSelections' : 'openFile'],
    filters: options.filters || defaultFilters,
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const fileInfos = result.filePaths.map((fp) => {
    const stats = fs.statSync(fp);
    return {
      path: fp,
      name: path.basename(fp),
      size: stats.size,
      ext: path.extname(fp).toLowerCase().replace('.', ''),
    };
  });

  return options.multi ? fileInfos : fileInfos[0];
});

ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Destination Folder',
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('shell:showInFolder', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('shell:openFile', async (event, filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    shell.openPath(filePath);
    return true;
  }
  return false;
});

ipcMain.handle('app:getDefaultOutputDir', () => {
  let videosDir;
  try {
    videosDir = app.getPath('videos');
  } catch (e) {
    videosDir = app.getPath('documents');
  }
  const itzCutDir = path.join(videosDir, 'itzCut');
  if (!fs.existsSync(itzCutDir)) {
    try {
      fs.mkdirSync(itzCutDir, { recursive: true });
    } catch (e) {}
  }
  return itzCutDir;
});

// IPC: Media Probing
ipcMain.handle('media:probe', async (event, filePath) => {
  try {
    return await ffmpegManager.probe(filePath);
  } catch (err) {
    throw new Error(err.message);
  }
});

// IPC: Preview Proxy Generator for Non-Native Formats (ProRes, PCM, HEVC, MKV, AVI, etc.)
ipcMain.handle('media:getPreviewProxy', async (event, filePath) => {
  try {
    return await ffmpegManager.ensurePreviewProxy(filePath);
  } catch (err) {
    throw new Error(err.message);
  }
});


// IPC: FFmpeg Status & Downloader
ipcMain.handle('ffmpeg:getStatus', async () => {
  return await ffmpegManager.detect();
});

ipcMain.handle('ffmpeg:download', async () => {
  try {
    return await ffmpegManager.downloadStaticBuild((progressData) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ffmpeg:download-progress', progressData);
      }
    });
  } catch (err) {
    throw new Error(err.message);
  }
});

// IPC: Jobs
ipcMain.handle('job:start', async (event, jobConfig) => {
  const { jobId } = jobConfig;

  try {
    const result = await transcoder.runJob(jobConfig, {
      onProgress: (progressData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('job:progress', { jobId, ...progressData });
        }
      },
      onComplete: (completeData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('job:complete', { jobId, ...completeData });
        }
      },
      onError: (err) => {
        if (transcoder.canceledJobs.has(jobId)) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('job:error', { jobId, error: err.message, log: err.log });
        }
      },
      onLog: (text) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('job:log', { jobId, text });
        }
      },
    });

    if (result && result.canceled) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('job:canceled', { jobId });
      }
    }

    return result;
  } catch (err) {
    if (transcoder.canceledJobs.has(jobId)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('job:canceled', { jobId });
      }
      return { jobId, canceled: true };
    }
    throw new Error(err.message);
  }
});

ipcMain.handle('job:cancel', (event, jobId) => {
  return transcoder.cancelJob(jobId);
});

// Debug Logging on Desktop
let isDebugMode = false;
let desktopLogPath = '';
try {
  desktopLogPath = path.join(app.getPath('desktop'), 'itzCut-debug.log');
} catch (e) {
  desktopLogPath = path.join(process.cwd(), 'itzCut-debug.log');
}

function writeDebugLog(category, message, details = null) {
  if (!isDebugMode) return;
  try {
    const timestamp = new Date().toISOString();
    let detailStr = '';
    if (details !== null && details !== undefined) {
      detailStr = typeof details === 'object' ? ' ' + JSON.stringify(details) : ' ' + details;
    }
    const line = `[${timestamp}] [${category.toUpperCase()}] ${message}${detailStr}\n`;
    fs.appendFileSync(desktopLogPath, line, 'utf8');
  } catch (err) {
    console.error('Debug log write error:', err);
  }
}

ipcMain.handle('debug:setMode', (event, enabled) => {
  isDebugMode = !!enabled;
  if (transcoder) transcoder.setDebugLogger(writeDebugLog);
  if (isDebugMode) {
    writeDebugLog('SYSTEM', 'itzCut Diagnostic Debug Mode Started', {
      appVersion: app.getVersion(),
      os: `${process.platform} ${process.arch}`,
      node: process.versions.node,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
    });
  }
  return { isDebugMode, logPath: desktopLogPath };
});

ipcMain.handle('debug:getStatus', () => {
  return { isDebugMode, logPath: desktopLogPath };
});

ipcMain.handle('debug:log', (event, { category = 'RENDERER', message = '', details = null }) => {
  writeDebugLog(category, message, details);
  return true;
});

ipcMain.handle('debug:openLogFile', async () => {
  if (fs.existsSync(desktopLogPath)) {
    await shell.openPath(desktopLogPath);
    return true;
  }
  return false;
});

// Auto-Updater IPC Handlers
ipcMain.handle('update:check', () => {
  if (autoUpdater) {
    return autoUpdater.checkForUpdates(true);
  }
  return { status: 'error', error: 'AutoUpdater not initialized' };
});

ipcMain.handle('update:quitAndInstall', () => {
  if (autoUpdater) {
    return autoUpdater.quitAndInstall();
  }
  return false;
});
