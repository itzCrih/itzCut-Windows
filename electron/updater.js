const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { app } = require('electron');

class AutoUpdater {
  constructor(mainWindow = null) {
    this.mainWindow = mainWindow;
    this.currentVersion = app.getVersion();
    this.isChecking = false;
    this.isDownloading = false;
    this.updateInfo = null;
    this.downloadedFilePath = null;
  }

  setWindow(win) {
    this.mainWindow = win;
  }

  send(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  isNewerVersion(remoteTag, localVer) {
    const cleanRemote = (remoteTag || '').replace(/^v/i, '').trim();
    const cleanLocal = (localVer || '').replace(/^v/i, '').trim();

    const rParts = cleanRemote.split('.').map((n) => parseInt(n, 10) || 0);
    const lParts = cleanLocal.split('.').map((n) => parseInt(n, 10) || 0);

    for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
      const r = rParts[i] || 0;
      const l = lParts[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  }

  async checkForUpdates(manual = false) {
    if (this.isChecking) return { status: 'checking' };
    this.isChecking = true;
    this.send('update:status', { status: 'checking', manual });

    try {
      const release = await this.fetchLatestRelease();
      this.isChecking = false;

      if (!release || !release.tag_name) {
        this.send('update:status', { status: 'up-to-date', currentVersion: this.currentVersion, manual });
        return { status: 'up-to-date', currentVersion: this.currentVersion };
      }

      const hasUpdate = this.isNewerVersion(release.tag_name, this.currentVersion);

      if (hasUpdate) {
        // Find Setup installer asset or any .exe asset
        const setupAsset =
          (release.assets || []).find((a) => /Setup.*\.exe$/i.test(a.name)) ||
          (release.assets || []).find((a) => /\.exe$/i.test(a.name));
        const downloadUrl = setupAsset ? setupAsset.browser_download_url : release.html_url;

        this.updateInfo = {
          version: release.tag_name.replace(/^v/i, ''),
          tagName: release.tag_name,
          releaseNotes: release.body || '',
          url: release.html_url,
          downloadUrl,
          size: setupAsset ? setupAsset.size : 0,
        };

        this.send('update:status', {
          status: 'available',
          updateInfo: this.updateInfo,
          manual,
        });

        // Automatically download update package in background
        if (setupAsset && downloadUrl) {
          this.downloadUpdate(downloadUrl);
        }

        return { status: 'available', updateInfo: this.updateInfo };
      } else {
        this.send('update:status', {
          status: 'up-to-date',
          currentVersion: this.currentVersion,
          latestVersion: release.tag_name.replace(/^v/i, ''),
          manual,
        });
        return { status: 'up-to-date', currentVersion: this.currentVersion };
      }
    } catch (err) {
      this.isChecking = false;
      this.send('update:status', { status: 'error', error: err.message, manual });
      return { status: 'error', error: err.message };
    }
  }

  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/itzCrih/itzCut-Windows/releases/latest',
        headers: {
          'User-Agent': 'itzCut-Desktop',
          Accept: 'application/vnd.github.v3+json',
        },
      };

      const req = https.get(options, (res) => {
        if (res.statusCode === 404) {
          return resolve(null);
        }
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return https
            .get(res.headers.location, { headers: options.headers }, (res2) => {
              let data = '';
              res2.on('data', (chunk) => (data += chunk));
              res2.on('end', () => {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(e);
                }
              });
            })
            .on('error', reject);
        }

        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Update check timed out'));
      });
    });
  }

  downloadUpdate(downloadUrl) {
    if (this.isDownloading) return;
    this.isDownloading = true;

    const tempDir = os.tmpdir();
    const dest = path.join(tempDir, `itzCut-Update-${this.updateInfo.version}.exe`);
    this.downloadedFilePath = dest;

    this.send('update:download-start', { version: this.updateInfo.version });

    const downloadStream = (targetUrl) => {
      const proto = targetUrl.startsWith('https') ? https : http;
      proto
        .get(targetUrl, { headers: { 'User-Agent': 'itzCut-Desktop' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return downloadStream(res.headers.location);
          }

          if (res.statusCode !== 200) {
            this.isDownloading = false;
            this.send('update:status', { status: 'download-error', error: `HTTP ${res.statusCode}` });
            return;
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;
          const fileStream = fs.createWriteStream(dest);

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            fileStream.write(chunk);
            const percent = totalBytes > 0 ? Math.round((receivedBytes / totalBytes) * 100) : 0;
            this.send('update:download-progress', {
              percent,
              receivedBytes,
              totalBytes,
            });
          });

          res.on('end', () => {
            fileStream.end();
            this.isDownloading = false;
            this.send('update:downloaded', {
              version: this.updateInfo.version,
              filePath: dest,
            });
          });

          res.on('error', (err) => {
            fileStream.end();
            this.isDownloading = false;
            this.send('update:status', { status: 'download-error', error: err.message });
          });
        })
        .on('error', (err) => {
          this.isDownloading = false;
          this.send('update:status', { status: 'download-error', error: err.message });
        });
    };

    downloadStream(downloadUrl);
  }

  quitAndInstall() {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      return false;
    }

    try {
      spawn(this.downloadedFilePath, [], {
        detached: true,
        stdio: 'ignore',
      }).unref();

      app.quit();
      return true;
    } catch (err) {
      console.error('Failed to launch downloaded update:', err);
      return false;
    }
  }
}

module.exports = AutoUpdater;
