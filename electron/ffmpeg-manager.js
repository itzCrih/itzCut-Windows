'use strict';

const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const { pipeline } = require('stream/promises');
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const crypto = require('crypto');
const frameBlend = require('./frame-blend');

const fsp = fs.promises;
const execFileAsync = promisify(execFile);

const IS_WINDOWS = process.platform === 'win32';
const EXE = IS_WINDOWS ? '.exe' : '';
const NULL_DEVICE = IS_WINDOWS ? 'NUL' : '/dev/null';

/** Bump when the cached shape changes so older cache files are ignored. */
const CACHE_VERSION = 2;
/** Hardware and drivers change; re-detect in the background once the cache is this old. */
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const PROBE_CACHE_SIZE = 8;

const FFMPEG_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest';
const FFMPEG_FALLBACK_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip';
const USER_AGENT = 'itzCut-Desktop';

const WEB_VIDEO_CODECS = ['h264', 'vp8', 'vp9', 'av1'];
const WEB_AUDIO_CODECS = ['aac', 'mp3', 'opus', 'vorbis', 'flac'];
const NON_WEB_CONTAINERS = ['.avi', '.wmv', '.flv', '.ts', '.m2ts', '.mts', '.3gp', '.vob', '.mpg', '.mpeg'];

/** Synthetic clips the blend engine self-test runs through FFmpeg: one even, one fractional ratio. */
const BLEND_SELF_TEST = { width: 64, height: 36, cases: [{ fps: 240, frames: 48 }, { fps: 100, frames: 40 }] };

function emptyStatus() {
  return {
    available: false,
    version: null,
    source: null, // 'system' or 'local'
    hardwareAccels: { nvenc: false, qsv: false, amf: false },
    systemInfo: { cpuModel: '', cpuCores: 0, ramGb: 0, gpuDevices: [], primaryGpu: '' },
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/** Changes whenever the binary is replaced, which is what invalidates everything detected from it. */
async function binaryIdentity(binaryPath) {
  try {
    const stat = await fsp.stat(binaryPath);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return null;
  }
}

async function findOnPath(fileName) {
  const directories = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of directories) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), fileName);
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function runFile(file, args, timeout = 10000) {
  return execFileAsync(file, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 });
}

/** Runs a process and resolves with its raw stdout. */
function collectOutput(file, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2000);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(stderr.trim() || `${path.basename(file)} exited with code ${code}`));
    });
  });
}

async function listGpuDevices() {
  if (!IS_WINDOWS) return [];
  try {
    const { stdout } = await runFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
      10000
    );
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function httpsGet(url, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      reject(new Error('Refusing to download over an insecure connection.'));
      return;
    }
    const request = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json, */*' } },
      (response) => {
        const { statusCode, headers } = response;
        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          response.resume();
          if (redirectsLeft <= 0) reject(new Error('Too many redirects.'));
          else resolve(httpsGet(new URL(headers.location, url).toString(), redirectsLeft - 1));
          return;
        }
        if (statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${statusCode}`));
          return;
        }
        resolve(response);
      }
    );
    request.setTimeout(30000, () => request.destroy(new Error('The connection timed out.')));
    request.on('error', reject);
  });
}

async function fetchJson(url) {
  const response = await httpsGet(url);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function sha256OfFile(filePath) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest('hex');
}

/**
 * Newest stable FFmpeg build published by BtbN (shared build: half the download and disk space of
 * the static one). Falls back to the nightly build when the release listing is unreachable.
 */
async function resolveFfmpegDownload() {
  try {
    const release = await fetchJson(FFMPEG_RELEASE_API);
    const stable = (release.assets || [])
      .map((asset) => ({ asset, match: /^ffmpeg-n(\d+)\.(\d+)-latest-win64-gpl-shared-[\d.]+\.zip$/.exec(asset.name) }))
      .filter((entry) => entry.match)
      .sort((a, b) => b.match[1] - a.match[1] || b.match[2] - a.match[2])[0];
    if (stable) {
      const digest = /^sha256:([0-9a-f]{64})$/i.exec(stable.asset.digest || '');
      return { url: stable.asset.browser_download_url, sha256: digest ? digest[1].toLowerCase() : null };
    }
  } catch {
    // Offline listing or rate limit: the nightly URL below never changes.
  }
  return { url: FFMPEG_FALLBACK_URL, sha256: null };
}

async function extractZip(zipPath, destination) {
  // Windows ships bsdtar, which reads zip archives as a stream. Use the System32 copy explicitly:
  // a GNU tar found on PATH cannot open zip files.
  const systemTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  try {
    await runFile(systemTar, ['-xf', zipPath, '-C', destination, '*/bin/*'], 5 * 60 * 1000);
  } catch {
    const quote = (value) => `'${value.replace(/'/g, "''")}'`;
    await runFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${quote(zipPath)} -DestinationPath ${quote(destination)} -Force`],
      10 * 60 * 1000
    );
  }
}

async function findDirectoryContaining(root, fileName) {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === fileName)) return root;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findDirectoryContaining(path.join(root, entry.name), fileName);
    if (found) return found;
  }
  return null;
}

function describeBlendCapability(videoStream) {
  const sourceFps = frameBlend.resolveSourceFps(videoStream.r_frame_rate, videoStream.avg_frame_rate);
  const plan = frameBlend.planFrameBlend({ sourceFps });
  return {
    eligible: plan.ok,
    code: plan.code || 'ok',
    reason: plan.reason || '',
    sourceFps: round2(sourceFps),
    outputFps: round2(plan.ok ? plan.outputFps : frameBlend.OUTPUT_FPS),
    minSourceFps: frameBlend.MIN_SOURCE_FPS,
    maxSourceFps: frameBlend.MAX_SOURCE_FPS,
  };
}

function previewProxyReason(fileExt, videoCodec, audioCodec) {
  if (NON_WEB_CONTAINERS.includes(fileExt)) return `Container ${fileExt.toUpperCase()} requires fast preview proxy`;
  if (videoCodec && !WEB_VIDEO_CODECS.includes(videoCodec)) return `Video codec ${videoCodec.toUpperCase()} requires fast preview proxy`;
  if (audioCodec && !WEB_AUDIO_CODECS.includes(audioCodec)) return `Audio codec ${audioCodec.toUpperCase()} requires fast preview proxy`;
  if (fileExt === '.mkv' && !['vp8', 'vp9', 'av1'].includes(videoCodec)) return 'MKV container requires fast preview proxy';
  return '';
}

class FFmpegManager {
  constructor(appDataPath) {
    this.appDataPath = appDataPath;
    this.binDir = path.join(appDataPath, 'bin');
    this.cachePath = path.join(appDataPath, 'hw-detect-cache.json');
    this.ffmpegPath = null;
    this.ffprobePath = null;
    this.status = emptyStatus();

    this.identity = null;
    this.blendEngine = null;
    this._detecting = null;
    this._selectingBlendEngine = null;
    this._probes = new Map();
    this._proxies = new Map();
  }

  snapshot() {
    return { ...this.status, ffmpegPath: this.ffmpegPath, ffprobePath: this.ffprobePath, binDir: this.binDir };
  }

  /**
   * Locates FFmpeg and probes the hardware encoders. Results are cached on disk, so only the first
   * launch (or a forced re-check) pays for the probing, and nothing here blocks the event loop.
   */
  detect(force = false) {
    if (this._detecting) return this._detecting;
    if (!force && this.status.available) return Promise.resolve(this.snapshot());

    this._detecting = (async () => {
      try {
        if (force || !(await this._loadCache())) await this._detectFresh();
        return this.snapshot();
      } finally {
        this._detecting = null;
      }
    })();
    return this._detecting;
  }

  async _loadCache() {
    try {
      const data = JSON.parse(await fsp.readFile(this.cachePath, 'utf8'));
      if (data.cacheVersion !== CACHE_VERSION || !data.status || !data.status.available) return false;
      if (Date.now() - data.timestamp > CACHE_MAX_AGE_MS) return false;
      if (!(await pathExists(data.ffprobePath))) return false;
      const identity = await binaryIdentity(data.ffmpegPath);
      if (!identity || identity !== data.identity) return false;

      this.ffmpegPath = data.ffmpegPath;
      this.ffprobePath = data.ffprobePath;
      this.identity = identity;
      this.blendEngine = data.blendEngine || null;
      this.status = data.status;
      return true;
    } catch {
      return false;
    }
  }

  async _saveCache() {
    try {
      await fsp.mkdir(this.appDataPath, { recursive: true });
      const data = {
        cacheVersion: CACHE_VERSION,
        timestamp: Date.now(),
        ffmpegPath: this.ffmpegPath,
        ffprobePath: this.ffprobePath,
        identity: this.identity,
        blendEngine: this.blendEngine,
        status: this.status,
      };
      await fsp.writeFile(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // The cache is an optimisation; failing to write it only costs a re-detection next launch.
    }
  }

  async _locateBinaries() {
    const local = { ffmpeg: path.join(this.binDir, `ffmpeg${EXE}`), ffprobe: path.join(this.binDir, `ffprobe${EXE}`) };
    if ((await pathExists(local.ffmpeg)) && (await pathExists(local.ffprobe))) return { ...local, source: 'local' };

    const [ffmpeg, ffprobe] = await Promise.all([findOnPath(`ffmpeg${EXE}`), findOnPath(`ffprobe${EXE}`)]);
    return ffmpeg && ffprobe ? { ffmpeg, ffprobe, source: 'system' } : null;
  }

  async _detectFresh() {
    const status = emptyStatus();
    const located = await this._locateBinaries();
    this.ffmpegPath = located ? located.ffmpeg : null;
    this.ffprobePath = located ? located.ffprobe : null;
    this.identity = null;
    this.blendEngine = null;
    this._selectingBlendEngine = null;

    if (located) {
      status.source = located.source;
      try {
        const { stdout } = await runFile(this.ffmpegPath, ['-hide_banner', '-version']);
        const match = /ffmpeg version (\S+)/i.exec(stdout);
        status.version = match ? match[1] : 'Unknown';
        status.available = true;
      } catch {
        status.available = false;
      }
    }

    if (status.available) {
      // Functional tests: an encoder being compiled in says nothing about the GPU being present.
      const [nvenc, qsv, amf, gpuDevices, identity] = await Promise.all([
        this.testHardwareEncoder('h264_nvenc'),
        this.testHardwareEncoder('h264_qsv'),
        this.testHardwareEncoder('h264_amf'),
        listGpuDevices(),
        binaryIdentity(this.ffmpegPath),
      ]);
      status.hardwareAccels = { nvenc, qsv, amf };
      const cpus = os.cpus();
      status.systemInfo = {
        cpuModel: cpus.length > 0 ? cpus[0].model.trim() : 'Standard CPU',
        cpuCores: cpus.length || 4,
        ramGb: Math.round(os.totalmem() / 1024 ** 3),
        gpuDevices,
        primaryGpu: gpuDevices.find((name) => /nvidia|geforce|rtx|gtx|radeon|rx\s/i.test(name)) || gpuDevices[0] || 'Standard GPU',
      };
      this.identity = identity;
    }

    this.status = status;
    if (status.available) await this._saveCache();
  }

  async testHardwareEncoder(encoderName) {
    if (!this.ffmpegPath) return false;
    try {
      await runFile(
        this.ffmpegPath,
        ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=1', '-frames:v', '1', '-c:v', encoderName, '-f', 'null', NULL_DEVICE],
        6000
      );
      return true;
    } catch {
      return false;
    }
  }

  async _requireBinary(name) {
    const key = `${name}Path`;
    if (!this[key]) await this.detect();
    if (!this[key]) throw new Error(`${name} binary not found. Please install or download FFmpeg.`);
    return this[key];
  }

  /** Reads container and stream metadata. Identical concurrent requests share one ffprobe run. */
  async probe(filePath) {
    const ffprobePath = await this._requireBinary('ffprobe');
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      throw new Error(`File does not exist: ${filePath}`);
    }

    const key = `${filePath}|${stat.size}|${stat.mtimeMs}`;
    let pending = this._probes.get(key);
    if (!pending) {
      pending = this._runProbe(ffprobePath, filePath);
      this._probes.set(key, pending);
      pending.catch(() => this._probes.delete(key));
      if (this._probes.size > PROBE_CACHE_SIZE) this._probes.delete(this._probes.keys().next().value);
    }
    return pending;
  }

  async _runProbe(ffprobePath, filePath) {
    let stdout;
    try {
      ({ stdout } = await runFile(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], 30000));
    } catch (err) {
      throw new Error(`ffprobe failed: ${(err.stderr || err.message || '').trim()}`);
    }

    let metadata;
    try {
      metadata = JSON.parse(stdout);
    } catch (err) {
      throw new Error(`Failed to parse media metadata: ${err.message}`);
    }

    const format = metadata.format || {};
    const streams = metadata.streams || [];
    // Cover art is exposed as a video stream; it must not turn an audio file into a "video".
    const videoStream = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
    const audioStream = streams.find((s) => s.codec_type === 'audio');

    const fileExt = path.extname(filePath).toLowerCase();
    const videoCodec = videoStream ? (videoStream.codec_name || '').toLowerCase() : '';
    const audioCodec = audioStream ? (audioStream.codec_name || '').toLowerCase() : '';
    const proxyReason = videoStream ? previewProxyReason(fileExt, videoCodec, audioCodec) : '';

    return {
      duration: parseFloat(format.duration || 0),
      size: parseInt(format.size || 0, 10),
      bitRate: parseInt(format.bit_rate || 0, 10),
      formatName: format.format_name,
      formatLongName: format.format_long_name,
      needsPreviewProxy: proxyReason !== '',
      previewProxyReason: proxyReason,
      video: videoStream
        ? {
            codec: videoStream.codec_name,
            width: videoStream.width,
            height: videoStream.height,
            aspectRatio: videoStream.display_aspect_ratio || `${videoStream.width}:${videoStream.height}`,
            fps: round2(frameBlend.parseFrameRate(videoStream.r_frame_rate)),
            avgFps: round2(frameBlend.parseFrameRate(videoStream.avg_frame_rate)),
            bitRate: parseInt(videoStream.bit_rate || 0, 10),
            pixelFormat: videoStream.pix_fmt,
            frameBlend: describeBlendCapability(videoStream),
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
      allStreams: streams.map((s) => ({ index: s.index, codecType: s.codec_type, codecName: s.codec_name })),
    };
  }

  /**
   * Which blending filtergraph this FFmpeg build can run. The fast polyphase graph is verified
   * once against the reference model on synthetic clips; a build that mishandles it (older or
   * unusual builds) silently gets the slower single-chain graph instead of a wrong export.
   */
  getBlendEngine() {
    if (this.blendEngine) return Promise.resolve(this.blendEngine);
    if (!this._selectingBlendEngine) {
      this._selectingBlendEngine = (async () => {
        const ffmpegPath = await this._requireBinary('ffmpeg');
        let verified = false;
        try {
          verified = await this._verifyBlendEngine(ffmpegPath, frameBlend.ENGINE_POLYPHASE);
        } catch {
          verified = false;
        }
        this.blendEngine = verified ? frameBlend.ENGINE_POLYPHASE : frameBlend.ENGINE_TMIX;
        await this._saveCache();
        return this.blendEngine;
      })().finally(() => {
        this._selectingBlendEngine = null;
      });
    }
    return this._selectingBlendEngine;
  }

  async _verifyBlendEngine(ffmpegPath, engine) {
    const results = await Promise.all(BLEND_SELF_TEST.cases.map((testCase) => this.measureBlendError(ffmpegPath, engine, testCase)));
    return results.every((result) => result.sourceCount > 0 && result.outputCount >= result.expectedCount && result.maxError <= 1.5);
  }

  /** Blends a synthetic clip with the given engine and compares every sample with the model. */
  async measureBlendError(ffmpegPath, engine, { fps, frames, speed = 1 }) {
    const { width, height } = BLEND_SELF_TEST;
    const plan = frameBlend.planFrameBlend({ sourceFps: fps, speed });
    const input = ['-f', 'lavfi', '-i', frameBlend.buildTestSource({ fps, frames, width, height })];
    const rawFrames = (args) => collectOutput(ffmpegPath, ['-v', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray16le', 'pipe:1']);
    const retime = speed !== 1 ? `settb=AVTB,setpts=PTS/${speed},` : '';

    const [original, blended] = await Promise.all([
      rawFrames(input),
      rawFrames([...input, '-filter_complex', frameBlend.buildBlendGraph(plan, { engine, input: `[0:v]${retime}` })]),
    ]);
    return frameBlend.compareWithReference(plan, original, blended, width * height * 2);
  }

  /** H.264 / AAC stand-in for sources Chromium cannot play (ProRes, HEVC in MKV, AVI ...). */
  async ensurePreviewProxy(filePath) {
    if (!filePath || !(await pathExists(filePath))) throw new Error(`File does not exist: ${filePath}`);
    const ffmpegPath = await this._requireBinary('ffmpeg');

    const proxyDir = path.join(os.tmpdir(), 'itzcut_previews');
    const stat = await fsp.stat(filePath);
    const hash = crypto.createHash('md5').update(`${filePath}_${stat.mtimeMs}_${stat.size}`).digest('hex');
    const proxyPath = path.join(proxyDir, `proxy_${hash}.mp4`);

    let pending = this._proxies.get(proxyPath);
    if (!pending) {
      pending = this._generatePreviewProxy(ffmpegPath, filePath, proxyDir, proxyPath).finally(() => this._proxies.delete(proxyPath));
      this._proxies.set(proxyPath, pending);
    }
    return pending;
  }

  async _generatePreviewProxy(ffmpegPath, filePath, proxyDir, proxyPath) {
    await fsp.mkdir(proxyDir, { recursive: true });
    try {
      if ((await fsp.stat(proxyPath)).size > 1024) return proxyPath;
    } catch {
      // Not generated yet.
    }

    // Encode into a scratch name and publish with a rename, so an interrupted run can never be
    // mistaken for a finished proxy.
    const partialPath = `${proxyPath}.${process.pid}.part.mp4`;
    try {
      await collectOutput(
        ffmpegPath,
        [
          '-y', '-hide_banner', '-v', 'error',
          '-i', filePath,
          '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'fastdecode', '-crf', '26',
          '-vf', 'scale=trunc(min(1280\\,iw)/2)*2:trunc(min(720\\,ih)/2)*2,format=yuv420p',
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          partialPath,
        ],
        30 * 60 * 1000
      );
      await fsp.rename(partialPath, proxyPath);
      return proxyPath;
    } catch (err) {
      await fsp.rm(partialPath, { force: true }).catch(() => {});
      throw new Error(`Failed to generate preview proxy: ${err.message.slice(-300)}`);
    }
  }

  /** Deletes preview proxies that have not been used for a few days. */
  async cleanupPreviewCache() {
    const proxyDir = path.join(os.tmpdir(), 'itzcut_previews');
    const cutoff = Date.now() - PREVIEW_MAX_AGE_MS;
    try {
      for (const name of await fsp.readdir(proxyDir)) {
        const filePath = path.join(proxyDir, name);
        const stat = await fsp.stat(filePath).catch(() => null);
        if (stat && stat.isFile() && Math.max(stat.mtimeMs, stat.atimeMs) < cutoff) {
          await fsp.rm(filePath, { force: true }).catch(() => {});
        }
      }
    } catch {
      // No preview directory yet.
    }
  }

  /** Decodes one frame as a JPEG data URL (random position when no timestamp is given). */
  async extractFrame(filePath, timestamp = null) {
    if (!filePath || !(await pathExists(filePath))) throw new Error(`File does not exist: ${filePath}`);
    const ffmpegPath = await this._requireBinary('ffmpeg');

    let seekSec = Number(timestamp);
    if (timestamp === null || timestamp === undefined || !Number.isFinite(seekSec)) {
      try {
        const duration = (await this.probe(filePath)).duration || 10;
        seekSec = Math.max(0.2, Math.min(duration - 0.2, duration * (0.1 + Math.random() * 0.7)));
      } catch {
        seekSec = 1.0;
      }
    }

    try {
      const jpeg = await collectOutput(ffmpegPath, [
        '-hide_banner', '-v', 'error',
        '-ss', seekSec.toFixed(3),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', 'scale=trunc(min(960\\,iw)/2)*2:-2',
        '-q:v', '3',
        '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1',
      ]);
      if (jpeg.length === 0) throw new Error('no frame decoded at that position');
      return { dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, timestamp: seekSec };
    } catch (err) {
      throw new Error(`Failed to extract preview frame: ${err.message.slice(-200)}`);
    }
  }

  /** Downloads FFmpeg into the app's own folder and switches to it. */
  async downloadStaticBuild(progressCallback) {
    const report = (data) => {
      if (progressCallback) progressCallback(data);
    };
    await fsp.mkdir(this.binDir, { recursive: true });
    const workDir = await fsp.mkdtemp(path.join(this.binDir, 'download-'));
    const zipPath = path.join(workDir, 'ffmpeg.zip');

    try {
      report({ status: 'starting', percent: 0, message: 'Connecting to server...' });
      const { url, sha256 } = await resolveFfmpegDownload();

      const response = await httpsGet(url);
      const totalBytes = parseInt(response.headers['content-length'] || 0, 10);
      let downloadedBytes = 0;
      let lastPercent = -1;
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const percent = totalBytes > 0 ? Math.min(99, Math.floor((downloadedBytes / totalBytes) * 100)) : 0;
        if (percent === lastPercent) return;
        lastPercent = percent;
        report({
          status: 'downloading',
          percent,
          downloadedBytes,
          totalBytes,
          message: `Downloading: ${percent}% (${Math.round(downloadedBytes / 1024 / 1024)}MB / ${Math.round(totalBytes / 1024 / 1024)}MB)`,
        });
      });
      await pipeline(response, fs.createWriteStream(zipPath));

      if (totalBytes > 0 && downloadedBytes !== totalBytes) throw new Error('The download was interrupted before it finished.');
      report({ status: 'extracting', percent: 100, message: 'Verifying and extracting binaries...' });
      if (sha256 && (await sha256OfFile(zipPath)) !== sha256) {
        throw new Error('The downloaded archive failed its integrity check. Please try again.');
      }

      const extractDir = path.join(workDir, 'extracted');
      await fsp.mkdir(extractDir);
      await extractZip(zipPath, extractDir);
      const sourceBin = await findDirectoryContaining(extractDir, 'ffmpeg.exe');
      if (!sourceBin || !(await pathExists(path.join(sourceBin, 'ffprobe.exe')))) {
        throw new Error('FFmpeg binaries were not found in the downloaded archive.');
      }

      for (const name of await fsp.readdir(sourceBin)) {
        if (/^ffplay\./i.test(name)) continue;
        await fsp.rename(path.join(sourceBin, name), path.join(this.binDir, name));
      }
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EBUSY') {
        throw new Error('FFmpeg is in use and could not be replaced. Wait for running jobs to finish and try again.');
      }
      throw err;
    } finally {
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    return this.detect(true);
  }
}

module.exports = FFmpegManager;
