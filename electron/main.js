const { app, BrowserWindow, ipcMain, dialog, shell, protocol, powerSaveBlocker, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const FFmpegManager = require('./ffmpeg-manager');
const Transcoder = require('./transcoder');
const AutoUpdater = require('./updater');
const { VIDEO_EXTS, AUDIO_EXTS, isMediaFile, mimeTypeFor } = require('./media-types');

const fsp = fs.promises;
const APP_ID = 'it.itzcrih.itzcut.desktop';
/** Folder imports stop here; a whole drive dropped by mistake must not freeze the app. */
const FOLDER_IMPORT_LIMIT = 500;
const FOLDER_IMPORT_DEPTH = 4;

// Optimization flags for stripped Windows 10/11 editions and low RAM usage
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.setAppUserModelId(APP_ID);

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

/** What the renderer reports about its queue: drives the taskbar, sleep blocking and the quit prompt. */
const queueState = { active: 0, queued: 0, progress: -1, keepAwake: true };
let powerBlockerId = null;
let quitConfirmed = false;

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function isHttpUrl(value) {
  return typeof value === 'string' && (value.startsWith('https://') || value.startsWith('http://'));
}

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
      sandbox: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });

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
      sandbox: true,
    },
  });

  // Securely intercept any external link or popup and open in user's default browser
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (isHttpUrl(targetUrl)) shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (isHttpUrl(targetUrl)) shell.openExternal(targetUrl);
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (onReady) {
      onReady();
    } else {
      mainWindow.show();
      mainWindow.focus();
      startAutoUpdater();
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

  mainWindow.on('maximize', () => sendToRenderer('window:state-changed', { maximized: true }));
  mainWindow.on('unmaximize', () => sendToRenderer('window:state-changed', { maximized: false }));
  mainWindow.on('minimize', () => sendToRenderer('app:background', true));
  mainWindow.on('restore', () => sendToRenderer('app:background', false));

  // Closing while encodes run would orphan hours of work: ask first, then stop FFmpeg cleanly.
  mainWindow.on('close', (event) => {
    const pending = queueState.active + queueState.queued + (transcoder ? transcoder.runningJobs.size : 0);
    if (quitConfirmed || pending === 0) return;
    event.preventDefault();
    const running = Math.max(queueState.active, transcoder ? transcoder.runningJobs.size : 0);
    dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        buttons: ['Keep Encoding', 'Quit Anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Encoding in progress',
        message: running > 0 ? `${running} encode${running === 1 ? ' is' : 's are'} still running.` : 'Jobs are still waiting in the queue.',
        detail: 'Quitting stops every job and deletes the unfinished files.',
      })
      .then(({ response }) => {
        if (response !== 1) return;
        quitConfirmed = true;
        app.quit();
      });
  });
}

function startAutoUpdater() {
  autoUpdater = new AutoUpdater(mainWindow);
  setTimeout(() => {
    if (autoUpdater) autoUpdater.checkForUpdates(false);
    // Housekeeping once the app is idle: drop stale preview proxies, pre-verify the blend engine.
    ffmpegManager.cleanupPreviewCache().catch(() => {});
    ffmpegManager.detect().then((s) => (s.available ? ffmpegManager.getBlendEngine() : null)).catch(() => {});
  }, 3500);
}

/** Serves local media to the <video> element with HTTP range support (never blocks the main process). */
async function handleMediaRequest(request) {
  try {
    const decodedPath = path.normalize(decodeURIComponent(request.url.replace(/^itzcut-media:\/\/local\//, '')));
    // Only media files (and the app's own preview proxies) are served, never arbitrary files.
    const inPreviewDir = decodedPath.toLowerCase().startsWith(FFmpegManager.previewDir().toLowerCase() + path.sep);
    if (!path.isAbsolute(decodedPath) || (!isMediaFile(decodedPath) && !inPreviewDir)) {
      return new Response('Forbidden', { status: 403 });
    }

    let stat;
    try {
      stat = await fsp.stat(decodedPath);
    } catch {
      return new Response('File not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('Not a file', { status: 404 });

    const fileSize = stat.size;
    const contentType = mimeTypeFor(decodedPath).startsWith('application/') ? 'video/mp4' : mimeTypeFor(decodedPath);
    const rangeHeader = request.headers.get('range');
    const range = rangeHeader && /^bytes=(\d*)-(\d*)/.exec(rangeHeader.trim());

    if (range && (range[1] || range[2])) {
      // "bytes=500-", "bytes=500-999" and suffix ranges "bytes=-500"
      let start = range[1] ? parseInt(range[1], 10) : Math.max(0, fileSize - parseInt(range[2], 10));
      let end = range[1] && range[2] ? parseInt(range[2], 10) : fileSize - 1;
      end = Math.min(end, fileSize - 1);
      if (start > end || start >= fileSize) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${fileSize}` } });
      }
      start = Math.max(0, start);

      return new Response(Readable.toWeb(fs.createReadStream(decodedPath, { start, end })), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': contentType,
        },
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(decodedPath)), {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
      },
    });
  } catch (err) {
    return new Response(err.message, { status: 500 });
  }
}

app.whenReady().then(async () => {
  const splashStartTime = Date.now();
  createSplashScreen();

  protocol.handle('itzcut-media', handleMediaRequest);

  const appDataPath = app.getPath('userData');
  ffmpegManager = new FFmpegManager(appDataPath);
  transcoder = new Transcoder(ffmpegManager);

  // FFmpeg & hardware detection runs fully async in the background; the UI never waits for it
  // (the renderer asks for the status itself and gets the same in-flight promise).
  ffmpegManager.detect().catch((err) => {
    console.error('FFmpeg detection error:', err);
  });

  createWindow(() => {
    const elapsed = Date.now() - splashStartTime;
    const minSplashDuration = 300; // Just long enough to avoid a splash "flash"
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
      startAutoUpdater();
    }, remainingDelay);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Never leave FFmpeg running after the window is gone: stop encodes (their partial files are
// removed) and any preview proxy, then quit for real.
let cleanedUp = false;
app.on('before-quit', (event) => {
  if (cleanedUp || !transcoder) return;
  event.preventDefault();
  cleanedUp = true;
  quitConfirmed = true;
  if (ffmpegManager) ffmpegManager.cancelAllPreviewProxies();
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
  Promise.race([transcoder.cancelAll(), timeout]).finally(() => app.quit());
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
  if (isHttpUrl(targetUrl)) {
    await shell.openExternal(targetUrl);
    return true;
  }
  return false;
});

async function describeFile(filePath) {
  const stat = await fsp.stat(filePath);
  return {
    path: filePath,
    name: path.basename(filePath),
    size: stat.size,
    ext: path.extname(filePath).toLowerCase().replace('.', ''),
  };
}

/**
 * Turns dropped or picked paths into media file descriptions. Folders are walked (a few levels
 * deep, hidden folders skipped) and everything that is not audio or video is left out.
 */
async function expandMediaPaths(paths) {
  const files = [];
  const seen = new Set();
  let skipped = 0;
  let truncated = false;

  const addFile = async (filePath) => {
    const key = filePath.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (!isMediaFile(filePath)) {
      skipped += 1;
      return;
    }
    if (files.length >= FOLDER_IMPORT_LIMIT) {
      truncated = true;
      return;
    }
    try {
      files.push(await describeFile(filePath));
    } catch {
      skipped += 1;
    }
  };

  const walk = async (directory, depth) => {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const entry of entries) {
      if (files.length >= FOLDER_IMPORT_LIMIT) {
        truncated = true;
        return;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (depth < FOLDER_IMPORT_DEPTH && !entry.name.startsWith('.') && !entry.name.startsWith('$')) await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        await addFile(fullPath);
      }
    }
  };

  for (const rawPath of Array.isArray(paths) ? paths : []) {
    if (typeof rawPath !== 'string' || !path.isAbsolute(rawPath)) continue;
    let stat;
    try {
      stat = await fsp.stat(rawPath);
    } catch {
      skipped += 1;
      continue;
    }
    if (stat.isDirectory()) await walk(rawPath, 0);
    else if (stat.isFile()) await addFile(rawPath);
  }
  return { files, skipped, truncated, limit: FOLDER_IMPORT_LIMIT };
}

ipcMain.handle('dialog:openFile', async (event, options = {}) => {
  const defaultFilters = [
    { name: 'Media Files', extensions: [...VIDEO_EXTS, ...AUDIO_EXTS] },
    { name: 'Video Files', extensions: VIDEO_EXTS },
    { name: 'Audio Files', extensions: AUDIO_EXTS },
  ];

  const result = await dialog.showOpenDialog(mainWindow, {
    title: options.title || (options.multi ? 'Select media files' : 'Select a media file'),
    properties: options.multi ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: Array.isArray(options.filters) ? options.filters : defaultFilters,
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  const fileInfos = (await Promise.all(result.filePaths.map((fp) => describeFile(fp).catch(() => null)))).filter(Boolean);
  return options.multi ? fileInfos : fileInfos[0] || null;
});

ipcMain.handle('dialog:openMediaFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import every video and audio file in a folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return expandMediaPaths(result.filePaths);
});

ipcMain.handle('media:expandPaths', (event, paths) => expandMediaPaths(paths));

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
  if (typeof filePath === 'string' && fs.existsSync(filePath)) {
    if (fs.statSync(filePath).isDirectory()) await shell.openPath(filePath);
    else shell.showItemInFolder(filePath);
    return true;
  }
  return false;
});

// Only media files are opened with their default app: never executables or scripts.
ipcMain.handle('shell:openFile', async (event, filePath) => {
  if (isMediaFile(filePath) && fs.existsSync(filePath)) {
    const error = await shell.openPath(filePath);
    return error === '';
  }
  return false;
});

ipcMain.handle('app:getDefaultOutputDir', async () => {
  let videosDir;
  try {
    videosDir = app.getPath('videos');
  } catch {
    videosDir = app.getPath('documents');
  }
  const itzCutDir = path.join(videosDir, 'itzCut');
  await fsp.mkdir(itzCutDir, { recursive: true }).catch(() => {});
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

// IPC: Preview Proxy Generator for Non-Native Formats (ProRes, PCM, HEVC in MKV, AVI, etc.)
ipcMain.handle('media:getPreviewProxy', async (event, filePath) => {
  try {
    return await ffmpegManager.ensurePreviewProxy(filePath);
  } catch (err) {
    throw new Error(err.message);
  }
});

ipcMain.handle('media:cancelPreviewProxy', (event, filePath) => ffmpegManager.cancelPreviewProxy(filePath));

// IPC: Extract single frame snapshot from video
ipcMain.handle('media:extractFrame', async (event, { filePath, timestamp }) => {
  try {
    return await ffmpegManager.extractFrame(filePath, timestamp);
  } catch (err) {
    throw new Error(err.message);
  }
});

// IPC: FFmpeg Status & Downloader
ipcMain.handle('ffmpeg:getStatus', async (event, force = false) => {
  return await ffmpegManager.detect(!!force);
});

ipcMain.handle('ffmpeg:download', async () => {
  try {
    return await ffmpegManager.downloadStaticBuild((progressData) => sendToRenderer('ffmpeg:download-progress', progressData));
  } catch (err) {
    throw new Error(err.message);
  }
});

// IPC: Engine preferences (encoder choice, process priority, GPU decoding)
ipcMain.handle('engine:setSettings', (event, settings) => transcoder.setEngineSettings(settings || {}));

function updatePowerBlocker() {
  const shouldBlock = queueState.keepAwake && queueState.active > 0;
  if (shouldBlock && powerBlockerId === null) {
    powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } else if (!shouldBlock && powerBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerBlockerId)) powerSaveBlocker.stop(powerBlockerId);
    powerBlockerId = null;
  }
}

ipcMain.on('queue:state', (event, state = {}) => {
  queueState.active = Math.max(0, Number(state.active) || 0);
  queueState.queued = Math.max(0, Number(state.queued) || 0);
  queueState.keepAwake = state.keepAwake !== false;
  const progress = Number(state.progress);
  queueState.progress = Number.isFinite(progress) ? progress : -1;

  if (mainWindow && !mainWindow.isDestroyed()) {
    if (queueState.active + queueState.queued > 0 && queueState.progress >= 0) {
      mainWindow.setProgressBar(Math.min(1, queueState.progress));
    } else {
      mainWindow.setProgressBar(-1);
    }
  }
  updatePowerBlocker();
});

ipcMain.on('app:notify', (event, { title, body } = {}) => {
  if (!Notification.isSupported() || typeof title !== 'string') return;
  const iconPath = path.join(__dirname, 'assets/icon.ico');
  const notification = new Notification({
    title: title.slice(0, 120),
    body: typeof body === 'string' ? body.slice(0, 300) : '',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
  });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  notification.show();
});

ipcMain.handle('app:isFocused', () => !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()));

// IPC: Jobs
ipcMain.handle('job:start', async (event, jobConfig) => {
  const jobId = jobConfig && jobConfig.jobId;

  try {
    const result = await transcoder.runJob(jobConfig, {
      onProgress: (progressData) => sendToRenderer('job:progress', { jobId, ...progressData }),
      onComplete: (completeData) => sendToRenderer('job:complete', { jobId, ...completeData }),
      onError: (err) => {
        if (transcoder.canceledJobs.has(jobId)) return;
        sendToRenderer('job:error', { jobId, error: err.message, log: err.log });
      },
      onLog: (text) => sendToRenderer('job:log', { jobId, text }),
    });

    if (result && result.canceled) sendToRenderer('job:canceled', { jobId });
    return result;
  } catch (err) {
    if (transcoder.canceledJobs.has(jobId)) {
      sendToRenderer('job:canceled', { jobId });
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
} catch {
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
    const line = `[${timestamp}] [${String(category).toUpperCase()}] ${message}${detailStr}\n`;
    fs.appendFile(desktopLogPath, line, 'utf8', () => {});
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

ipcMain.handle('debug:log', (event, { category = 'RENDERER', message = '', details = null } = {}) => {
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
    quitConfirmed = true;
    return autoUpdater.quitAndInstall();
  }
  return false;
});
