const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const os = require('os');

class FFmpegManager {
  constructor(appDataPath) {
    this.appDataPath = appDataPath;
    this.binDir = path.join(appDataPath, 'bin');
    this.ffmpegPath = null;
    this.ffprobePath = null;
    this.status = {
      available: false,
      version: null,
      source: null, // 'system' or 'local'
      hardwareAccels: {
        nvenc: false,
        qsv: false,
        amf: false,
      },
      systemInfo: {
        cpuModel: '',
        cpuCores: 0,
        ramGb: 0,
        gpuDevices: [],
        primaryGpu: '',
      },
    };
  }

  ensureBinDir() {
    if (!fs.existsSync(this.binDir)) {
      fs.mkdirSync(this.binDir, { recursive: true });
    }
  }

  async detect() {
    // 1. Check local bin directory first
    const localFfmpeg = path.join(this.binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const localFfprobe = path.join(this.binDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

    if (fs.existsSync(localFfmpeg) && fs.existsSync(localFfprobe)) {
      this.ffmpegPath = localFfmpeg;
      this.ffprobePath = localFfprobe;
      this.status.source = 'local';
    } else {
      // 2. Check system PATH
      try {
        const checkCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
        const ffmpegOutput = execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];
        const checkProbeCmd = process.platform === 'win32' ? 'where ffprobe' : 'which ffprobe';
        const ffprobeOutput = execSync(checkProbeCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split(/\r?\n/)[0];

        if (ffmpegOutput && ffprobeOutput) {
          this.ffmpegPath = ffmpegOutput;
          this.ffprobePath = ffprobeOutput;
          this.status.source = 'system';
        }
      } catch (err) {
        // Not in PATH
      }
    }

    if (this.ffmpegPath) {
      try {
        const versionOutput = execSync(`"${this.ffmpegPath}" -version`, { encoding: 'utf8' });
        const match = versionOutput.match(/ffmpeg version ([^\s]+)/i);
        this.status.version = match ? match[1] : 'Unknown';
        this.status.available = true;

        // Functional physical tests for real GPU hardware encoder availability
        try {
          this.status.hardwareAccels.nvenc = this.testHardwareEncoder('h264_nvenc');
          this.status.hardwareAccels.qsv = this.testHardwareEncoder('h264_qsv');
          this.status.hardwareAccels.amf = this.testHardwareEncoder('h264_amf');
        } catch (e) {
          // Ignore
        }

        // Query real PC hardware specs (CPU, RAM, GPU adapters)
        this.detectSystemInfo();
      } catch (e) {
        this.status.available = false;
      }
    } else {
      this.status.available = false;
    }

    return {
      ...this.status,
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      binDir: this.binDir,
    };
  }

  testHardwareEncoder(encoderName) {
    if (!this.ffmpegPath) return false;
    try {
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const cmd = `"${this.ffmpegPath}" -y -f lavfi -i testsrc=size=320x240:rate=1 -c:v ${encoderName} -frames:v 1 -f null ${nullDevice}`;
      execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], timeout: 4000 });
      return true;
    } catch (e) {
      return false;
    }
  }

  detectSystemInfo() {
    try {
      const cpus = os.cpus();
      const cpuModel = cpus && cpus[0] ? cpus[0].model.trim() : 'Standard CPU';
      const cpuCores = cpus ? cpus.length : 4;
      const ramGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));

      let gpuDevices = [];
      if (process.platform === 'win32') {
        try {
          const out = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_VideoController).Name"', {
            encoding: 'utf8',
            timeout: 8000,
            stdio: ['pipe', 'pipe', 'ignore'],
          });
          gpuDevices = out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        } catch (e) {
          // Fallback if PowerShell command fails
        }
      }

      const primaryGpu =
        gpuDevices.find((g) => /nvidia|geforce|rtx|gtx|radeon|rx\s/i.test(g)) ||
        gpuDevices[0] ||
        'Standard GPU';

      this.status.systemInfo = {
        cpuModel,
        cpuCores,
        ramGb,
        gpuDevices,
        primaryGpu,
      };
    } catch (e) {
      // Ignore
    }
  }

  async probe(filePath) {
    if (!this.ffprobePath) {
      await this.detect();
    }
    if (!this.ffprobePath) {
      throw new Error('ffprobe binary not found. Please install or download FFmpeg.');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath,
      ];

      const proc = spawn(this.ffprobePath, args);
      let stdoutData = '';
      let stderrData = '';

      proc.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(new Error(`ffprobe failed with exit code ${code}: ${stderrData}`));
        }
        try {
          const metadata = JSON.parse(stdoutData);
          const format = metadata.format || {};
          const streams = metadata.streams || [];

          const videoStream = streams.find((s) => s.codec_type === 'video');
          const audioStream = streams.find((s) => s.codec_type === 'audio');

          let fps = 0;
          if (videoStream && videoStream.r_frame_rate) {
            const parts = videoStream.r_frame_rate.split('/');
            if (parts.length === 2 && Number(parts[1]) > 0) {
              fps = Math.round((Number(parts[0]) / Number(parts[1])) * 100) / 100;
            }
          }

          const result = {
            duration: parseFloat(format.duration || 0),
            size: parseInt(format.size || 0, 10),
            bitRate: parseInt(format.bit_rate || 0, 10),
            formatName: format.format_name,
            formatLongName: format.format_long_name,
            video: videoStream
              ? {
                  codec: videoStream.codec_name,
                  width: videoStream.width,
                  height: videoStream.height,
                  aspectRatio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`,
                  fps,
                  bitRate: parseInt(videoStream.bit_rate || 0, 10),
                  pixelFormat: videoStream.pix_fmt,
                }
              : null,
            audio: audioStream
              ? {
                  codec: audioStream.codec_name,
                  channels: audioStream.channels,
                  sampleRate: parseInt(audioStream.sample_rate || 0, 10),
                  bitRate: parseInt(audioStream.bit_rate || 0, 10),
                }
              : null,
            allStreams: streams.map((s) => ({
              index: s.index,
              codecType: s.codec_type,
              codecName: s.codec_name,
            })),
          };

          resolve(result);
        } catch (err) {
          reject(new Error(`Failed to parse media metadata: ${err.message}`));
        }
      });
    });
  }

  async downloadStaticBuild(progressCallback) {
    this.ensureBinDir();

    const downloadUrl = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
    const tempZipPath = path.join(this.binDir, 'ffmpeg_download.zip');

    if (progressCallback) {
      progressCallback({ status: 'starting', percent: 0, message: 'Connecting to server...' });
    }

    await this._downloadFileWithRedirects(downloadUrl, tempZipPath, progressCallback);

    if (progressCallback) {
      progressCallback({ status: 'extracting', percent: 100, message: 'Extracting binaries...' });
    }

    const zip = new AdmZip(tempZipPath);
    const zipEntries = zip.getEntries();

    let ffmpegFound = false;
    let ffprobeFound = false;

    for (const entry of zipEntries) {
      const entryName = entry.entryName.toLowerCase();
      if (entryName.endsWith('ffmpeg.exe')) {
        const data = entry.getData();
        fs.writeFileSync(path.join(this.binDir, 'ffmpeg.exe'), data);
        ffmpegFound = true;
      } else if (entryName.endsWith('ffprobe.exe')) {
        const data = entry.getData();
        fs.writeFileSync(path.join(this.binDir, 'ffprobe.exe'), data);
        ffprobeFound = true;
      }
    }

    try {
      fs.unlinkSync(tempZipPath);
    } catch (e) {}

    if (!ffmpegFound || !ffprobeFound) {
      throw new Error('FFmpeg binaries were not found in the downloaded archive.');
    }

    return await this.detect();
  }

  _downloadFileWithRedirects(url, destinationPath, progressCallback, redirectCount = 0) {
    if (redirectCount > 8) {
      return Promise.reject(new Error('Too many redirects while downloading FFmpeg.'));
    }

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const request = protocol.get(url, { headers: { 'User-Agent': 'itzCut-Windows/1.0' } }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return resolve(this._downloadFileWithRedirects(response.headers.location, destinationPath, progressCallback, redirectCount + 1));
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        }

        const totalBytes = parseInt(response.headers['content-length'] || 0, 10);
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(destinationPath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && progressCallback) {
            const percent = Math.min(99, Math.round((downloadedBytes / totalBytes) * 100));
            progressCallback({
              status: 'downloading',
              percent,
              downloadedBytes,
              totalBytes,
              message: `Downloading: ${percent}% (${Math.round(downloadedBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`,
            });
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(destinationPath, () => {});
          reject(err);
        });
      });

      request.on('error', (err) => {
        fs.unlink(destinationPath, () => {});
        reject(err);
      });
    });
  }
}

module.exports = FFmpegManager;
