const { contextBridge, ipcRenderer, webUtils } = require('electron');

/** Subscribes to a main-process event and returns the unsubscribe function. */
function subscribe(channel) {
  return (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('itzCutAPI', {
  // Absolute path of a dropped File (works for folders too)
  getPathForFile: (file) => {
    try {
      if (webUtils && typeof webUtils.getPathForFile === 'function') {
        return webUtils.getPathForFile(file);
      }
    } catch {
      // Not a local file.
    }
    return '';
  },

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window:minimize'),
  maximizeWindow: () => ipcRenderer.send('window:maximize'),
  closeWindow: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  isFocused: () => ipcRenderer.invoke('app:isFocused'),

  // Dialogs & Shell
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),
  openMediaFolderDialog: () => ipcRenderer.invoke('dialog:openMediaFolder'),
  expandMediaPaths: (paths) => ipcRenderer.invoke('media:expandPaths', paths),
  selectFolderDialog: () => ipcRenderer.invoke('dialog:selectFolder'),
  showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('shell:openFile', filePath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  getDefaultOutputDir: () => ipcRenderer.invoke('app:getDefaultOutputDir'),
  notify: (title, body) => ipcRenderer.send('app:notify', { title, body }),

  // Media Inspection
  probeFile: (filePath) => ipcRenderer.invoke('media:probe', filePath),
  getPreviewProxy: (filePath) => ipcRenderer.invoke('media:getPreviewProxy', filePath),
  cancelPreviewProxy: (filePath) => ipcRenderer.invoke('media:cancelPreviewProxy', filePath),
  extractFrame: (filePath, timestamp) => ipcRenderer.invoke('media:extractFrame', { filePath, timestamp }),

  // FFmpeg Engine Status & Auto-Download
  getFfmpegStatus: (force = false) => ipcRenderer.invoke('ffmpeg:getStatus', force),
  downloadFfmpeg: () => ipcRenderer.invoke('ffmpeg:download'),
  onFfmpegDownloadProgress: subscribe('ffmpeg:download-progress'),
  setEngineSettings: (settings) => ipcRenderer.invoke('engine:setSettings', settings),

  // Jobs & Transcoding
  startJob: (jobConfig) => ipcRenderer.invoke('job:start', jobConfig),
  cancelJob: (jobId) => ipcRenderer.invoke('job:cancel', jobId),
  reportQueueState: (state) => ipcRenderer.send('queue:state', state),

  // Realtime Events
  onJobProgress: subscribe('job:progress'),
  onJobComplete: subscribe('job:complete'),
  onJobError: subscribe('job:error'),
  onJobCanceled: subscribe('job:canceled'),
  onJobLog: subscribe('job:log'),

  // Diagnostics & Debug Logs
  setDebugMode: (enabled) => ipcRenderer.invoke('debug:setMode', enabled),
  getDebugMode: () => ipcRenderer.invoke('debug:getStatus'),
  writeDebugLog: (category, message, details) => ipcRenderer.invoke('debug:log', { category, message, details }),
  openDebugLogFile: () => ipcRenderer.invoke('debug:openLogFile'),

  // Software Auto-Updates
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('update:quitAndInstall'),
  onUpdateStatus: subscribe('update:status'),
  onUpdateDownloadProgress: subscribe('update:download-progress'),
  onUpdateDownloaded: subscribe('update:downloaded'),
});
