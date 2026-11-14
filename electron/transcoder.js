'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const frameBlend = require('./frame-blend');

const fsp = fs.promises;

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const BASE_ARGS = ['-y', '-hide_banner', '-nostdin'];
const BRAND_METADATA = ['-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it'];
/** Only the tail of FFmpeg's output is kept per job; multi-hour encodes would otherwise grow without bound. */
const LOG_TAIL_CHARS = 200000;
const FASTSTART_CONTAINERS = ['.mp4', '.mov', '.m4v'];
const HARDWARE_ENCODER = /_(nvenc|qsv|amf)$/;
const HARDWARE_FAILURE = /nvenc|qsv|amf|cuda|nvcuda|d3d11|mfx|hardware|device creation failed|error while opening encoder|could not open encoder/i;

const STANDARD_RESOLUTIONS = {
  '4k': { w: 3840, h: 2160, dar: '16/9' },
  '1440p': { w: 2560, h: 1440, dar: '16/9' },
  '1080p': { w: 1920, h: 1080, dar: '16/9' },
  '720p': { w: 1280, h: 720, dar: '16/9' },
  '480p': { w: 854, h: 480, dar: '16/9' },
  '360p': { w: 640, h: 360, dar: '16/9' },
};

const ASPECT_CANVASES = {
  '16:9': { w: 1920, h: 1080, dar: '16/9' },
  '9:16': { w: 1080, h: 1920, dar: '9/16' },
  '1:1': { w: 1080, h: 1080, dar: '1/1' },
  '4:3': { w: 1440, h: 1080, dar: '4/3' },
};

const ROTATION_FILTERS = {
  '90cw': 'transpose=1',
  '90ccw': 'transpose=2',
  '180': 'transpose=2,transpose=2',
  hflip: 'hflip',
  vflip: 'vflip',
};

const AUDIO_CODEC_BY_EXTENSION = {
  '.mp3': ['-c:a', 'libmp3lame', '-b:a', '320k'],
  '.wav': ['-c:a', 'pcm_s16le'],
  '.flac': ['-c:a', 'flac'],
  '.aac': ['-c:a', 'aac', '-b:a', '256k'],
  '.m4a': ['-c:a', 'aac', '-b:a', '256k'],
  '.opus': ['-c:a', 'libopus', '-b:a', '160k'],
  '.ogg': ['-c:a', 'libopus', '-b:a', '160k'],
};

function formatSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
  const pad = (value) => String(Math.floor(value)).padStart(2, '0');
  return `${pad(seconds / 3600)}:${pad((seconds % 3600) / 60)}:${pad(seconds % 60)}`;
}

/** Pulls the fields of one FFmpeg status line ("frame=... time=00:00:04.20 ... speed=2.1x"). */
function parseProgress(text) {
  const time = /time=(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!time) return null;
  const fps = /fps=\s*(\d+(?:\.\d+)?)/.exec(text);
  const speed = /speed=\s*(\d+(?:\.\d+)?)x/.exec(text);
  const bitrate = /bitrate=\s*([\d.]+\s*\w+\/s)/.exec(text);
  return {
    seconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
    fps: fps ? fps[1] : null,
    speed: speed ? speed[1] : null,
    bitrate: bitrate ? bitrate[1] : null,
  };
}

async function removeFiles(files) {
  await Promise.all(files.map((file) => fsp.rm(file, { force: true }).catch(() => {})));
}

function passLogFiles(prefix) {
  return [`${prefix}-0.log`, `${prefix}-0.log.mbtree`, `${prefix}-0.log.mbtree.temp`];
}

function metadataArgs(strip) {
  return strip ? ['-map_metadata', '-1'] : BRAND_METADATA;
}

function fastStartArgs(outputFile) {
  return FASTSTART_CONTAINERS.includes(path.extname(outputFile).toLowerCase()) ? ['-movflags', '+faststart'] : [];
}

/** Constant-quality settings; `quality` is on the x264 CRF scale for every encoder. */
function qualityEncoderArgs(encoder, quality, softwareArgs) {
  const q = String(quality);
  if (encoder.type === 'nvenc') return ['-c:v', encoder.encoder, '-rc:v', 'vbr', '-cq', q, '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (encoder.type === 'qsv') return ['-c:v', encoder.encoder, '-global_quality', q, '-pix_fmt', 'nv12'];
  if (encoder.type === 'amf') return ['-c:v', encoder.encoder, '-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-pix_fmt', 'yuv420p'];
  return softwareArgs;
}

function scaleToCanvas(canvas, fit) {
  const { w, h, dar } = canvas;
  const tail = `setsar=1:1,setdar=${dar}`;
  if (fit === 'stretch') return `scale=${w}:${h},${tail}`;
  if (fit === 'crop') return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${tail}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,${tail}`;
}

/** Filters that turn the stream into the requested cadence: strict CFR, or the app's VFR mode. */
function frameRateFilters(fps, isVfr) {
  const hasTarget = fps && fps !== 'original';
  if (!isVfr) return hasTarget ? [`fps=${fps}`] : [];

  const filters = [];
  const targetFps = parseFloat(fps);
  if (hasTarget && targetFps > 0) {
    const minInterval = (1 / targetFps) * 0.95;
    filters.push(`select='eq(n\\,0)+gt(t-prev_selected_t\\,${minInterval.toFixed(5)})'`);
  }
  // Sub-millisecond timestamp variance so containers and MediaInfo tag the stream as variable.
  filters.push("setpts='PTS-STARTPTS+if(eq(N\\,0)\\,0\\,(mod(N\\,3)*0.0005)/TB)'");
  return filters;
}

function gifFilterArgs(fps) {
  return ['-filter_complex', `[0:v] fps=${fps},scale=480:-1:flags=lanczos,split [a][b];[a] palettegen [p];[b][p] paletteuse`];
}

class Transcoder {
  constructor(ffmpegManager) {
    this.ffmpegManager = ffmpegManager;
    this.activeJobs = new Map(); // jobId -> child process currently running for it
    this.runningJobs = new Set(); // jobIds between runJob() start and settle
    this.canceledJobs = new Set();
    this.debugLogger = null;
  }

  setDebugLogger(fn) {
    this.debugLogger = fn;
  }

  logDebug(category, message, details = null) {
    if (this.debugLogger) this.debugLogger(category, message, details);
  }

  /** Stops a running job. Its partial output is removed once FFmpeg has released the file. */
  cancelJob(jobId) {
    if (!this.runningJobs.has(jobId)) return false;
    this.canceledJobs.add(jobId);
    const proc = this.activeJobs.get(jobId);
    if (proc) {
      try {
        proc.kill();
      } catch {
        // Already exited.
      }
    }
    return true;
  }

  getPreferredVideoEncoder(requestedCodec = 'libx264', softwareOnly = false) {
    const isHevc = requestedCodec.includes('x265') || requestedCodec.includes('hevc');
    const family = isHevc ? 'hevc' : 'h264';
    const accels = (this.ffmpegManager && this.ffmpegManager.status && this.ffmpegManager.status.hardwareAccels) || {};

    if (!softwareOnly) {
      for (const type of ['nvenc', 'qsv', 'amf']) {
        if (accels[type]) return { encoder: `${family}_${type}`, isHardware: true, type };
      }
    }
    return { encoder: isHevc ? 'libx265' : 'libx264', isHardware: false };
  }

  parseResolution(resolution, customResolution = null) {
    if (!resolution || resolution === 'original') return null;
    if (STANDARD_RESOLUTIONS[resolution]) return STANDARD_RESOLUTIONS[resolution];

    const raw = String(resolution === 'custom' ? customResolution || '' : resolution).trim();
    const match = raw.match(/(\d{2,5})\s*[*xX:\-,\s]\s*(\d{2,5})/);
    if (!match) return null;
    // H.264 / HEVC encoders need even dimensions.
    const w = parseInt(match[1], 10) & ~1;
    const h = parseInt(match[2], 10) & ~1;
    return w > 0 && h > 0 ? { w, h, dar: `${w}/${h}` } : null;
  }

  buildScaleFilter(targetRes, canvasFit = 'pad') {
    return targetRes ? scaleToCanvas(targetRes, canvasFit) : null;
  }

  /**
   * Runs a job to completion.
   * Resolves with `{ success: true, outputPath, outputSize }` or `{ canceled: true }`; rejects when
   * the job fails, after `onError` has been told why.
   */
  async runJob(jobConfig, callbacks = {}) {
    const { jobId, outputFile } = jobConfig;
    const options = jobConfig.options || {};
    const { onProgress, onComplete, onError } = callbacks;
    const scratchFiles = [];
    this.runningJobs.add(jobId);

    const canceled = async () => {
      await removeFiles([outputFile, ...scratchFiles]);
      this.logDebug('FFMPEG', `Job canceled cleanly by user [${jobId}]`);
      return { jobId, canceled: true, success: false };
    };

    try {
      if (!this.ffmpegManager.ffmpegPath) await this.ffmpegManager.detect();
      const ffmpegPath = this.ffmpegManager.ffmpegPath;
      if (!ffmpegPath) throw new Error('FFmpeg not found. Please install or download FFmpeg before processing.');

      await fsp.mkdir(path.dirname(outputFile), { recursive: true });
      const context = { frameBlend: await this._resolveFrameBlend(jobConfig) };
      if (this.canceledJobs.has(jobId)) return await canceled();

      const run = options.type === 'tiktok'
        ? await this._runTwoPass(ffmpegPath, jobConfig, callbacks, scratchFiles)
        : await this._runSinglePass(ffmpegPath, jobConfig, callbacks, context);

      if (this.canceledJobs.has(jobId)) return await canceled();
      await removeFiles(scratchFiles);

      if (run.code !== 0) {
        await removeFiles([outputFile]);
        const err = new Error(run.failure || `FFmpeg exited with error code ${run.code}.`);
        err.log = run.log;
        throw err;
      }

      const outputSize = await fsp.stat(outputFile).then((stat) => stat.size, () => 0);
      const result = { jobId, outputPath: outputFile, outputSize, success: true };
      this.logDebug('FFMPEG', `Job completed successfully [${jobId}]`, { outputSize });
      if (onProgress) onProgress({ percent: 100 });
      if (onComplete) onComplete(result);
      return result;
    } catch (err) {
      await removeFiles(scratchFiles);
      if (this.canceledJobs.has(jobId)) return canceled();
      this.logDebug('FFMPEG', `Job failed [${jobId}]: ${err.message}`, { errorSnippet: (err.log || '').slice(-300) });
      if (onError) onError(err);
      throw err;
    } finally {
      this.runningJobs.delete(jobId);
      this.canceledJobs.delete(jobId);
    }
  }

  /** Validates a frame blending request against the real source and picks the filtergraph engine. */
  async _resolveFrameBlend(jobConfig) {
    const options = jobConfig.options || {};
    if (jobConfig.mode !== 'trim' || !options.frameBlend || options.isAudioOnly || options.exportAsGif) return null;

    const info = await this.ffmpegManager.probe(jobConfig.inputFile);
    if (!info.video) throw new Error('Frame blending needs a video stream.');
    const plan = frameBlend.planFrameBlend({ sourceFps: info.video.frameBlend.sourceFps, speed: Number(options.speed) || 1 });
    if (!plan.ok) throw new Error(`Frame blending is not available for this clip. ${plan.reason}`);

    const engine = plan.blend ? await this.ffmpegManager.getBlendEngine() : null;
    this.logDebug('FFMPEG', `Frame blending ${frameBlend.describeBlend(plan)} [${jobConfig.jobId}]`, {
      sourceFps: plan.sourceFps,
      outputFps: plan.outputFps,
      engine,
    });
    return { plan, engine };
  }

  async _runSinglePass(ffmpegPath, jobConfig, callbacks, context) {
    const options = jobConfig.options || {};
    const speed = jobConfig.mode === 'trim' ? Number(options.speed) || 1 : 1;
    const totalDuration = (jobConfig.duration || options.customDuration || 0) / speed;

    const attempt = (softwareOnly) => {
      const args = this.buildArgs(jobConfig, softwareOnly, context);
      this.logDebug('FFMPEG', `Starting ${jobConfig.mode || 'job'} [${jobConfig.jobId}]`, {
        outputFile: jobConfig.outputFile,
        isSoftwareFallback: softwareOnly,
        args: args.join(' '),
      });
      return this._runFfmpeg(ffmpegPath, jobConfig.jobId, args, { ...callbacks, totalDuration }).then((run) => ({ ...run, args }));
    };

    let run = await attempt(false);
    const usedHardware = run.args.some((arg) => HARDWARE_ENCODER.test(arg));
    // GPU encoders fail for reasons the CPU does not share (driver, session limit, unsupported
    // input). The error is at the end of the log, so unrelated late failures are not retried.
    if (run.code !== 0 && usedHardware && !this.canceledJobs.has(jobConfig.jobId) && HARDWARE_FAILURE.test(run.log.slice(-1500))) {
      this.logDebug('FFMPEG', `Hardware encoder failed. Falling back to software encoding for [${jobConfig.jobId}]`);
      if (callbacks.onLog) callbacks.onLog('\n[itzCut] Hardware encoder failed, retrying with software encoding...\n');
      run = await attempt(true);
    }
    return run;
  }

  /** TikTok profile: two-pass x264 VBR at 20 Mbps (40 Mbps peak), constant frame rate. */
  async _runTwoPass(ffmpegPath, jobConfig, callbacks, scratchFiles) {
    const { jobId, inputFile, outputFile, duration = 0 } = jobConfig;
    const options = jobConfig.options || {};
    const totalDuration = duration || options.customDuration || 0;
    const passLogPrefix = path.join(os.tmpdir(), `itzcut_passlog_${process.pid}_${jobId}`);
    scratchFiles.push(...passLogFiles(passLogPrefix));

    // Both passes must share the preset: x264 rejects a second pass whose frame-type settings
    // (B-frames, lookahead) differ from the statistics file.
    const video = [
      '-c:v', 'libx264', '-profile:v', 'main', '-refs', '4',
      '-b:v', '20M', '-maxrate', '40M', '-bufsize', '40M',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr',
      '-preset', options.preset || 'medium',
      '-passlogfile', passLogPrefix,
    ];
    const runPass = (pass, tail, percentRange) => {
      const args = [...BASE_ARGS, '-i', inputFile, ...video, '-pass', String(pass), ...tail];
      this.logDebug('FFMPEG', `Starting TikTok Pass ${pass} [${jobId}]`, { args: args.join(' ') });
      return this._runFfmpeg(ffmpegPath, jobId, args, { ...callbacks, totalDuration, percentRange, pass });
    };

    if (callbacks.onProgress) callbacks.onProgress({ percent: 1 });
    const analysis = await runPass(1, ['-an', '-f', 'null', NULL_DEVICE], [0, 50]);
    if (analysis.code !== 0 || this.canceledJobs.has(jobId)) {
      return { ...analysis, failure: `FFmpeg pass 1 failed with code ${analysis.code}.` };
    }

    const encode = await runPass(
      2,
      [...this._audioArgs(options, ['-c:a', 'aac', '-b:a', '192k']), ...metadataArgs(options.stripMetadata), '-movflags', '+faststart', outputFile],
      [50, 100]
    );
    return { ...encode, failure: `FFmpeg pass 2 failed with code ${encode.code}.` };
  }

  /** Spawns FFmpeg and reports its progress. Resolves with the exit code and the end of its log. */
  _runFfmpeg(ffmpegPath, jobId, args, { onLog, onProgress, totalDuration = 0, percentRange = [0, 100], pass } = {}) {
    return new Promise((resolve) => {
      let log = '';
      let proc;
      try {
        proc = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (err) {
        resolve({ code: -1, log: err.message, failure: `Could not start FFmpeg: ${err.message}` });
        return;
      }
      this.activeJobs.set(jobId, proc);
      // A job canceled while its process was being prepared must not start encoding.
      if (this.canceledJobs.has(jobId)) proc.kill();

      proc.stderr.setEncoding('utf8');
      proc.stderr.on('data', (text) => {
        log = (log + text).slice(-LOG_TAIL_CHARS);
        if (onLog) onLog(text);

        const progress = parseProgress(text);
        if (!progress || !onProgress) return;
        const [from, to] = percentRange;
        const fraction = totalDuration > 0 ? Math.min(1, progress.seconds / totalDuration) : 0;
        const encodeSpeed = progress.speed ? parseFloat(progress.speed) : 1;
        onProgress({
          percent: Math.min(to - 0.5, Math.round((from + fraction * (to - from)) * 10) / 10),
          currentTime: formatSeconds(progress.seconds),
          currentSeconds: progress.seconds,
          totalTime: formatSeconds(totalDuration),
          fps: progress.fps,
          speed: progress.speed ? `${progress.speed}x` : null,
          bitrate: progress.bitrate,
          eta: totalDuration > 0 && encodeSpeed > 0 ? formatSeconds(Math.max(0, totalDuration - progress.seconds) / encodeSpeed) : null,
          ...(pass ? { pass } : {}),
        });
      });

      const finish = (result) => {
        if (this.activeJobs.get(jobId) === proc) this.activeJobs.delete(jobId);
        resolve(result);
      };
      proc.on('error', (err) => finish({ code: -1, log: `${log}\n${err.message}`, failure: `Could not start FFmpeg: ${err.message}` }));
      proc.on('close', (code) => finish({ code: code === null ? -1 : code, log }));
    });
  }

  /** `-an`, or the optional gain filter followed by the given codec arguments. */
  _audioArgs(options, codecArgs) {
    if (options.muteAudio) return ['-an'];
    const boostDb = parseFloat(options.audioBoostDb) || 0;
    return [...(boostDb > 0 ? ['-af', `volume=${boostDb}dB`] : []), ...codecArgs];
  }

  /**
   * FFmpeg arguments for a job.
   * @param softwareOnly skip the GPU encoders (used when a hardware attempt failed)
   * @param context values resolved asynchronously before the job starts ({ frameBlend })
   */
  buildArgs(jobConfig, softwareOnly = false, context = {}) {
    if (jobConfig.mode === 'trim') return this._buildTrimArgs(jobConfig, softwareOnly, context);
    if (jobConfig.mode === 'compress') return this._buildCompressArgs(jobConfig, softwareOnly);
    if (jobConfig.mode === 'convert') return this._buildConvertArgs(jobConfig, softwareOnly);

    const options = jobConfig.options || {};
    return [...BASE_ARGS, '-i', jobConfig.inputFile, ...(options.stripMetadata ? [] : BRAND_METADATA), '-c', 'copy', jobConfig.outputFile];
  }

  _buildTrimArgs(jobConfig, softwareOnly, context) {
    const { inputFile, outputFile } = jobConfig;
    const options = {
      start: 0,
      end: 0,
      muteAudio: false,
      losslessCopy: false,
      speed: 1,
      rotation: 'none',
      aspectRatio: 'original',
      canvasFit: 'pad',
      audioBoostDb: 0,
      loudnorm: false,
      exportAsGif: false,
      gifFps: 15,
      ...jobConfig.options,
    };
    const { start, end, speed } = options;
    const blend = context.frameBlend || null;
    const boostDb = parseFloat(options.audioBoostDb) || 0;

    const args = [...BASE_ARGS];
    if (start > 0) args.push('-ss', String(start));
    if (end > start) args.push('-to', String(end));
    args.push('-i', inputFile);

    const canvas = options.aspectRatio !== 'original' ? ASPECT_CANVASES[options.aspectRatio] || ASPECT_CANVASES['16:9'] : null;
    const needsVideoEncode = speed !== 1 || options.rotation !== 'none' || canvas !== null || options.exportAsGif || blend !== null;
    const needsAudioEncode = boostDb > 0 || options.loudnorm;

    // Stream copy is only possible while nothing has to be decoded; dropping the audio track still is.
    if (options.losslessCopy && !needsVideoEncode && !needsAudioEncode) {
      if (options.muteAudio) args.push('-an');
      args.push('-c', 'copy', outputFile);
      return args;
    }

    const audioFilters = [];
    if (speed !== 1) audioFilters.push(`atempo=${speed}`);
    if (boostDb > 0) audioFilters.push(`volume=${boostDb}dB`);
    if (options.loudnorm) audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    const audioFilterArgs = audioFilters.length > 0 ? ['-af', audioFilters.join(',')] : [];

    if (options.isAudioOnly) {
      const codec = AUDIO_CODEC_BY_EXTENSION[path.extname(outputFile).toLowerCase()] || ['-c:a', 'aac', '-b:a', '192k'];
      args.push('-vn', ...audioFilterArgs, ...codec, ...metadataArgs(options.stripMetadata), outputFile);
      return args;
    }

    if (options.exportAsGif) {
      args.push(...gifFilterArgs(options.gifFps), outputFile);
      return args;
    }

    // Geometry runs after blending: the result is identical (both are linear) and four times
    // fewer frames go through the scaler.
    const geometry = [];
    if (ROTATION_FILTERS[options.rotation]) geometry.push(ROTATION_FILTERS[options.rotation]);
    if (canvas) geometry.push(scaleToCanvas(canvas, options.canvasFit));

    if (blend) {
      // A microsecond timebase keeps the retimed timestamps exact before they are conformed.
      const retime = speed !== 1 ? `settb=AVTB,setpts=PTS/${speed},` : '';
      const graph = frameBlend.buildBlendGraph(blend.plan, { engine: blend.engine, input: `[0:v:0]${retime}` });
      args.push('-filter_complex', [graph, ...geometry].join(','));
    } else {
      const filters = [...(speed !== 1 ? [`setpts=${1 / speed}*PTS`] : []), ...geometry];
      if (filters.length > 0) args.push('-vf', filters.join(','));
    }

    args.push(
      ...qualityEncoderArgs(this.getPreferredVideoEncoder('libx264', softwareOnly), 19, ['-c:v', 'libx264', '-crf', '19', '-preset', 'fast', '-pix_fmt', 'yuv420p'])
    );
    if (options.muteAudio) args.push('-an');
    else args.push(...audioFilterArgs, '-c:a', 'aac', '-b:a', '192k');
    args.push(...metadataArgs(options.stripMetadata), ...fastStartArgs(outputFile));

    // The blend graph pads the tail so the last frames are fully mixed; cut back to the clip length.
    if (blend && end > start) args.push('-t', ((end - start) / speed).toFixed(6));

    args.push(outputFile);
    return args;
  }

  _buildCompressArgs(jobConfig, softwareOnly) {
    const { inputFile, outputFile, duration = 0 } = jobConfig;
    const options = { type: 'target_size', targetSizeMB: 25, crf: 24, preset: 'medium', muteAudio: false, ...jobConfig.options };
    const args = [...BASE_ARGS, '-i', inputFile];
    const encoder = this.getPreferredVideoEncoder('libx264', softwareOnly);

    if (options.type === 'target_size' || options.type === 'discord') {
      const seconds = duration > 0 ? duration : 60;
      const totalBits = options.targetSizeMB * 8 * 1024 * 1024 * 0.96;
      const audioKbps = options.muteAudio ? 0 : 96;
      const videoBits = Math.max(totalBits - audioKbps * 1000 * seconds, totalBits * 0.5);
      const videoKbps = Math.max(50, Math.floor(videoBits / seconds / 1000));
      const rate = ['-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.35)}k`, '-bufsize', `${Math.round(videoKbps * 2)}k`];

      if (encoder.isHardware) args.push('-c:v', encoder.encoder, ...rate, ...(encoder.type === 'qsv' ? [] : ['-pix_fmt', 'yuv420p']));
      else args.push('-c:v', 'libx264', ...rate, '-preset', options.preset, '-pix_fmt', 'yuv420p');
      args.push(...this._audioArgs(options, ['-c:a', 'aac', '-b:a', `${audioKbps}k`]));
    } else {
      args.push(
        ...qualityEncoderArgs(encoder, options.crf, ['-c:v', 'libx264', '-crf', String(options.crf), '-fastfirstpass', '1', '-preset', options.preset, '-pix_fmt', 'yuv420p'])
      );
      args.push(...this._audioArgs(options, options.audioBitrate ? ['-c:a', 'aac', '-b:a', options.audioBitrate] : []));
    }

    const isVfr = options.fpsMode === 'vfr';
    const filters = [];
    const targetRes = this.parseResolution(options.resolution, options.customResolution);
    if (targetRes) filters.push(scaleToCanvas(targetRes, options.canvasFit || 'pad'));
    filters.push(...frameRateFilters(options.fps, isVfr));
    if (filters.length > 0) args.push('-vf', filters.join(','));

    args.push('-fps_mode', isVfr ? 'vfr' : 'cfr');
    if (isVfr) args.push('-bsf:v', 'h264_metadata=fixed_frame_rate_flag=0');

    args.push(...metadataArgs(options.stripMetadata), ...fastStartArgs(outputFile), outputFile);
    return args;
  }

  _buildConvertArgs(jobConfig, softwareOnly) {
    const { inputFile, outputFile } = jobConfig;
    const options = {
      format: 'mp4',
      videoCodec: 'libx264',
      audioCodec: 'aac',
      resolution: 'original',
      fps: 'original',
      crf: 22,
      videoBitrate: null,
      audioBitrate: '192k',
      audioOnly: false,
      muteAudio: false,
      stripMetadata: false,
      canvasFit: 'pad',
      audioBoostDb: 0,
      ...jobConfig.options,
    };
    const outExt = path.extname(outputFile).toLowerCase();
    const boostDb = parseFloat(options.audioBoostDb) || 0;
    const args = [...BASE_ARGS, '-i', inputFile];

    if (options.audioOnly) {
      args.push('-vn', ...this._convertAudioOnlyArgs(options, outExt, boostDb));
    } else if (options.format === 'gif') {
      args.push(...gifFilterArgs(options.fps === 'original' ? 15 : options.fps));
    } else {
      args.push(...this._convertVideoArgs(options, outExt, softwareOnly, boostDb));
    }

    args.push(...metadataArgs(options.stripMetadata));
    if (!options.audioOnly) args.push(...fastStartArgs(outputFile));
    args.push(outputFile);
    return args;
  }

  _convertAudioOnlyArgs(options, outExt, boostDb) {
    const { audioCodec, audioBitrate } = options;
    const args = [];
    if (boostDb > 0 && audioCodec !== 'copy') args.push('-af', `volume=${boostDb}dB`);
    if (options.sampleRate) args.push('-ar', String(options.sampleRate));
    if (options.channels) args.push('-ac', String(options.channels));
    if (audioCodec === 'copy') return [...args, '-c:a', 'copy'];

    let codec = audioCodec;
    if (codec === 'mp3' || outExt === '.mp3') codec = 'libmp3lame';
    else if (codec === 'wav' || outExt === '.wav') codec = 'pcm_s16le';
    else if (codec === 'flac' || outExt === '.flac') codec = 'flac';
    else if (codec === 'opus' || outExt === '.opus') codec = 'libopus';
    else if (codec === 'ogg' || outExt === '.ogg') codec = 'libvorbis';
    else if (['m4a', 'aac'].includes(codec) || ['.m4a', '.aac'].includes(outExt)) codec = 'aac';

    args.push('-c:a', codec);
    if (audioBitrate && codec !== 'pcm_s16le' && codec !== 'flac') args.push('-b:a', audioBitrate);
    return args;
  }

  _convertVideoArgs(options, outExt, softwareOnly, boostDb) {
    const { videoCodec, videoBitrate, crf } = options;
    const args = [];
    const isX26x = videoCodec.includes('x264') || videoCodec.includes('x265');
    const encoder = this.getPreferredVideoEncoder(videoCodec, softwareOnly);
    let activeEncoder = videoCodec;

    if (videoBitrate) {
      activeEncoder = encoder.isHardware ? encoder.encoder : videoCodec;
      args.push('-c:v', activeEncoder, '-b:v', videoBitrate, ...(encoder.isHardware ? ['-pix_fmt', 'yuv420p'] : []));
    } else if (isX26x) {
      activeEncoder = encoder.encoder;
      const software = ['-c:v', videoCodec, '-crf', String(crf), ...(videoCodec.includes('x264') ? ['-fastfirstpass', '1'] : []), '-preset', 'medium', '-pix_fmt', 'yuv420p'];
      args.push(...qualityEncoderArgs(encoder, crf, software));
    } else if (videoCodec === 'libvpx-vp9') {
      // VP9's quality scale sits about nine steps above x264's; row-mt and cpu-used 4 make the
      // encoder use every core instead of its single-threaded, near-archival default.
      args.push('-c:v', videoCodec, '-crf', String(Math.min(63, Number(crf) + 9)), '-b:v', '0', '-row-mt', '1', '-cpu-used', '4');
    } else {
      args.push('-c:v', videoCodec);
    }

    // QuickTime and iOS only play HEVC in MP4/MOV when it is tagged hvc1.
    if (/hevc|265/.test(activeEncoder) && FASTSTART_CONTAINERS.includes(outExt)) args.push('-tag:v', 'hvc1');

    const isVfr = options.fpsMode === 'vfr';
    const filters = [];
    const targetRes = this.parseResolution(options.resolution, options.customResolution);
    if (targetRes) filters.push(scaleToCanvas(targetRes, options.canvasFit));
    filters.push(...frameRateFilters(options.fps, isVfr));
    if (filters.length > 0) args.push('-vf', filters.join(','));

    args.push('-fps_mode', isVfr ? 'vfr' : 'cfr');
    if (isVfr && /264/.test(activeEncoder)) args.push('-bsf:v', 'h264_metadata=fixed_frame_rate_flag=0');

    if (options.muteAudio) return [...args, '-an'];

    // WebM only carries Opus or Vorbis audio.
    const audioCodec = outExt === '.webm' && !['libopus', 'libvorbis', 'copy'].includes(options.audioCodec) ? 'libopus' : options.audioCodec;
    if (boostDb > 0 && audioCodec !== 'copy') args.push('-af', `volume=${boostDb}dB`);
    args.push('-c:a', audioCodec);
    if (options.audioBitrate && audioCodec !== 'copy') args.push('-b:a', options.audioBitrate);
    return args;
  }

  formatSeconds(seconds) {
    return formatSeconds(seconds);
  }
}

module.exports = Transcoder;
