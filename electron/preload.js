const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('itzCutAPI', {
  // Safe dropped file path resolver for modern Electron
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch (e) {}
    return file?.path || '';
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // Dialogs & Shell
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  selectFolderDialog: () => ipcRenderer.invoke('dialog:selectFolder'),
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDefaultOutputDir: () => ipcRenderer.invoke('app:getDefaultOutputDir'),

  // Media Inspection
  probeFile: (filePath) => ipcRenderer.invoke('media:probe', filePath),

  // FFmpeg Engine Status & Auto-Download
  getFfmpegStatus: () => ipcRenderer.invoke('ffmpeg:getStatus'),
  downloadFfmpeg: () => ipcRenderer.invoke('ffmpeg:download'),
  onFfmpegDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('ffmpeg:download-progress', listener);
    return () => ipcRenderer.removeListener('ffmpeg:download-progress', listener);
  },

  // Jobs & Transcoding
  startJob: (jobConfig) => ipcRenderer.invoke('job:start', jobConfig),
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),

  // Realtime Events
  onJobProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('job:progress', listener);
    return () => ipcRenderer.removeListener('job:progress', listener);
  },
  onJobComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('job:complete', listener);
    return () => ipcRenderer.removeListener('job:complete', listener);
  },
  onJobError: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('job:error', listener);
    return () => ipcRenderer.removeListener('job:error', listener);
  },
  onJobCanceled: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('job:canceled', listener);
    return () => ipcRenderer.removeListener('job:canceled', listener);
  },
  onJobLog: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('job:log', listener);
    return () => ipcRenderer.removeListener('job:log', listener);
  },

  // Diagnostics & Debug Logs
  setDebugMode: (enabled) => ipcRenderer.invoke('debug:setMode', enabled),
  getDebugMode: () => ipcRenderer.invoke('debug:getStatus'),
  writeDebugLog: (category, message, details) => ipcRenderer.invoke('debug:log', { category, message, details }),
  openDebugLogFile: () => ipcRenderer.invoke('debug:openLogFile'),

  // Software Auto-Updates
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update:quitAndInstall'),
  onUpdateStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
  onUpdateDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update:download-progress', listener);
    return () => ipcRenderer.removeListener('update:download-progress', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update:downloaded', listener);
    return () => ipcRenderer.removeListener('update:downloaded', listener);
  },
});

