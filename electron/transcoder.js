'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const frameBlend = require('./frame-blend');
const { isOutputExtension } = require('./media-types');

const fsp = fs.promises;

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const BASE_ARGS = ['-y', '-hide_banner', '-nostdin'];
const BRAND_METADATA = ['-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it'];
/** Only the tail of FFmpeg's output is kept per job; multi-hour encodes would otherwise grow without bound. */
const LOG_TAIL_CHARS = 200000;
const FASTSTART_CONTAINERS = ['.mp4', '.mov', '.m4v'];
const HARDWARE_ENCODER = /_(nvenc|qsv|amf)$/;
const HARDWARE_FAILURE = /nvenc|qsv|amf|cuda|nvcuda|d3d11|dxva|hwaccel|mfx|hardware|device creation failed|error while opening encoder|could not open encoder/i;

const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'];
/** The x264 speed scale translated to each GPU encoder's own presets. */
const HARDWARE_PRESETS = {
  nvenc: { ultrafast: 'p1', superfast: 'p1', veryfast: 'p2', faster: 'p3', fast: 'p4', medium: 'p5', slow: 'p6', slower: 'p7', veryslow: 'p7' },
  qsv: { ultrafast: 'veryfast', superfast: 'veryfast', veryfast: 'veryfast', faster: 'faster', fast: 'fast', medium: 'medium', slow: 'slow', slower: 'slower', veryslow: 'veryslow' },
  amf: { ultrafast: 'speed', superfast: 'speed', veryfast: 'speed', faster: 'speed', fast: 'balanced', medium: 'balanced', slow: 'quality', slower: 'quality', veryslow: 'quality' },
};

const PROCESS_PRIORITY = {
  normal: os.constants.priority.PRIORITY_NORMAL,
  below: os.constants.priority.PRIORITY_BELOW_NORMAL,
  low: os.constants.priority.PRIORITY_LOW,
};

/**
 * Variable frame rate: frames that repeat the previous one (static scenes, menus, duplicated
 * capture frames) are dropped and the survivors keep their real timestamps. At most 30 frames in
 * a row are dropped so players and editors never see multi-second gaps.
 */
const VFR_DECIMATE = 'mpdecimate=hi=64*3:lo=64*2:frac=0.33:max=30';
/**
 * Fully dynamic footage has nothing to decimate and would come out with perfectly even frame
 * durations, which MediaInfo and editors report as constant. Every other frame is shifted by
 * half a millisecond (45 ticks of the 1/90000 timebase): invisible, never reorders frames, and it
 * makes the stream genuinely variable in the container.
 */
const VFR_MARKER = "setpts='PTS+if(mod(N\\,2)\\,45\\,0)'";
const VFR_TIMEBASE = 'settb=1/90000';

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

const CANVAS_FITS = ['pad', 'crop', 'stretch'];

const AUDIO_CODEC_BY_EXTENSION = {
  '.mp3': ['-c:a', 'libmp3lame', '-b:a', '320k'],
  '.wav': ['-c:a', 'pcm_s16le'],
  '.flac': ['-c:a', 'flac'],
  '.aac': ['-c:a', 'aac', '-b:a', '256k'],
  '.m4a': ['-c:a', 'aac', '-b:a', '256k'],
  '.opus': ['-c:a', 'libopus', '-b:a', '160k'],
  '.ogg': ['-c:a', 'libopus', '-b:a', '160k'],
};
/** Audio-only containers that carry a single stream: several chosen tracks are mixed instead. */
const SINGLE_AUDIO_STREAM = ['.mp3', '.wav', '.flac', '.aac', '.opus', '.ogg', '.m4a'];

const AUDIO_CODECS = ['aac', 'libmp3lame', 'mp3', 'pcm_s16le', 'wav', 'flac', 'libopus', 'opus', 'libvorbis', 'ogg', 'm4a', 'copy'];
const VIDEO_CODECS = ['libx264', 'libx265', 'libvpx-vp9', 'gif'];

/** A finite number clamped to a range, or the fallback. Every renderer value that ends up inside an FFmpeg filter goes through here. */
function num(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bitrate(value, fallback = null) {
  return typeof value === 'string' && /^\d{1,6}k$/.test(value) ? value : fallback;
}

function presetName(value) {
  return X264_PRESETS.includes(value) ? value : 'medium';
}

/** 'original' or a frame rate between 1 and 300 fps, as a plain decimal string. */
function frameRate(value) {
  if (!value || value === 'original') return 'original';
  const fps = num(value, 1, 300, 0);
  return fps > 0 ? String(Math.round(fps * 1000) / 1000) : 'original';
}

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
  const rate = /bitrate=\s*([\d.]+\s*\w+\/s)/.exec(text);
  return {
    seconds: Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]),
    fps: fps ? fps[1] : null,
    speed: speed ? speed[1] : null,
    bitrate: rate ? rate[1] : null,
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

function hardwarePresetArgs(encoder, preset) {
  const value = HARDWARE_PRESETS[encoder.type] && HARDWARE_PRESETS[encoder.type][presetName(preset)];
  if (!value) return [];
  return encoder.type === 'amf' ? ['-quality', value] : ['-preset', value];
}

/** Constant-quality settings; `quality` is on the x264 CRF scale for every encoder. */
function qualityEncoderArgs(encoder, quality, softwareArgs, preset) {
  const q = String(quality);
  const speed = hardwarePresetArgs(encoder, preset);
  if (encoder.type === 'nvenc') return ['-c:v', encoder.encoder, ...speed, '-rc:v', 'vbr', '-cq', q, '-b:v', '0', '-pix_fmt', 'yuv420p'];
  if (encoder.type === 'qsv') return ['-c:v', encoder.encoder, ...speed, '-global_quality', q, '-pix_fmt', 'nv12'];
  if (encoder.type === 'amf') return ['-c:v', encoder.encoder, ...speed, '-rc', 'cqp', '-qp_i', q, '-qp_p', q, '-pix_fmt', 'yuv420p'];
  return softwareArgs;
}

function scaleToCanvas(canvas, fit) {
  const { w, h, dar } = canvas;
  const tail = `setsar=1:1,setdar=${dar}`;
  if (fit === 'stretch') return `scale=${w}:${h},${tail}`;
  if (fit === 'crop') return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},${tail}`;
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,${tail}`;
}

/** Filters that turn the stream into the requested cadence: strict CFR, or true VFR (see VFR_DECIMATE). */
function frameRateFilters(fps, isVfr) {
  const target = fps === 'original' ? 0 : parseFloat(fps);
  if (!isVfr) return target > 0 ? [`fps=${fps}`] : [];

  const filters = [VFR_TIMEBASE, VFR_DECIMATE];
  // A target frame rate is a ceiling in VFR mode: frames closer together than 1/fps are skipped.
  if (target > 0) filters.push(`select='eq(n\\,0)+gt(t-prev_selected_t\\,${(0.95 / target).toFixed(5)})'`);
  filters.push(VFR_MARKER);
  return filters;
}

/** Muxer and bitstream settings that keep a VFR stream's real timestamps in the file. */
function frameRateModeArgs(isVfr, encoderName, outputFile) {
  if (!isVfr) return ['-fps_mode', 'cfr'];
  const args = ['-fps_mode', 'vfr'];
  if (FASTSTART_CONTAINERS.includes(path.extname(outputFile).toLowerCase())) args.push('-video_track_timescale', '90000');
  if (/264/.test(encoderName)) args.push('-bsf:v', 'h264_metadata=fixed_frame_rate_flag=0');
  return args;
}

function gifFilterArgs(fps) {
  return ['-filter_complex', `[0:v] fps=${fps},scale=480:-1:flags=lanczos,split [a][b];[a] palettegen [p];[b][p] paletteuse`];
}

/** WebM only carries Opus or Vorbis; everything else gets AAC. */
function defaultAudioCodec(outputFile) {
  return path.extname(outputFile).toLowerCase() === '.webm' ? ['-c:a', 'libopus', '-b:a', '160k'] : ['-c:a', 'aac', '-b:a', '192k'];
}

class Transcoder {
  constructor(ffmpegManager) {
    this.ffmpegManager = ffmpegManager;
    this.activeJobs = new Map(); // jobId -> child process currently running for it
    this.runningJobs = new Set(); // jobIds between runJob() start and settle
    this.settling = new Map(); // jobId -> promise that settles when runJob() does
    this.canceledJobs = new Set();
    this.claimedOutputs = new Set(); // lower-cased output paths reserved by running jobs
    this.debugLogger = null;
    this.engine = { forceSoftware: false, priority: 'normal', hwDecode: false };
  }

  setDebugLogger(fn) {
    this.debugLogger = fn;
  }

  /** Global encoding preferences from the Settings page. */
  setEngineSettings(settings = {}) {
    this.engine = {
      forceSoftware: !!settings.forceSoftware,
      priority: PROCESS_PRIORITY[settings.priority] !== undefined ? settings.priority : 'normal',
      hwDecode: !!settings.hwDecode,
    };
    // Running encodes pick up a priority change immediately.
    for (const proc of this.activeJobs.values()) this._applyPriority(proc);
    return this.engine;
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

  /** Cancels every running job and resolves once all of them have cleaned up (used on quit). */
  async cancelAll() {
    const pending = [...this.runningJobs].map((jobId) => {
      this.cancelJob(jobId);
      return this.settling.get(jobId);
    });
    await Promise.allSettled(pending);
  }

  getPreferredVideoEncoder(requestedCodec = 'libx264', softwareOnly = false) {
    const isHevc = requestedCodec.includes('x265') || requestedCodec.includes('hevc');
    const family = isHevc ? 'hevc' : 'h264';
    const accels = (this.ffmpegManager && this.ffmpegManager.status && this.ffmpegManager.status.hardwareAccels) || {};

    if (!softwareOnly && !this.engine.forceSoftware) {
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
    const w = Math.min(8192, parseInt(match[1], 10)) & ~1;
    const h = Math.min(8192, parseInt(match[2], 10)) & ~1;
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
  runJob(jobConfig, callbacks = {}) {
    const run = this._runJob(jobConfig, callbacks);
    const jobId = jobConfig && jobConfig.jobId;
    if (jobId) {
      const settled = run.then(() => {}, () => {});
      this.settling.set(jobId, settled);
      settled.then(() => {
        if (this.settling.get(jobId) === settled) this.settling.delete(jobId);
      });
    }
    return run;
  }

  async _runJob(jobConfig, callbacks) {
    const { onProgress, onComplete, onError } = callbacks;
    const validationError = this._validateJob(jobConfig);
    if (validationError) {
      const err = new Error(validationError);
      if (onError) onError(err);
      throw err;
    }

    const { jobId } = jobConfig;
    const options = jobConfig.options || {};
    const scratchFiles = [];
    this.runningJobs.add(jobId);
    // Never overwrite an earlier export: "name.mp4" becomes "name (2).mp4".
    const outputFile = await this._claimOutputPath(jobConfig.outputFile);
    jobConfig = { ...jobConfig, outputFile };

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
      const context = {
        frameBlend: await this._resolveFrameBlend(jobConfig),
        audioTracks: await this._resolveAudioTracks(jobConfig),
      };
      if (this.canceledJobs.has(jobId)) return await canceled();

      const run = options.type === 'tiktok'
        ? await this._runTwoPass(ffmpegPath, jobConfig, callbacks, scratchFiles, context)
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
      // Once the job settles the file exists on disk (or was removed), so the claim can go.
      this.claimedOutputs.delete(outputFile.toLowerCase());
      this.runningJobs.delete(jobId);
      this.canceledJobs.delete(jobId);
    }
  }

  /** First free variant of a path, reserved so two jobs starting together cannot pick the same one. */
  async _claimOutputPath(outputFile) {
    const ext = path.extname(outputFile);
    const stem = outputFile.slice(0, outputFile.length - ext.length);
    for (let n = 1; n < 1000; n += 1) {
      const candidate = n === 1 ? outputFile : `${stem} (${n})${ext}`;
      const key = candidate.toLowerCase();
      if (this.claimedOutputs.has(key)) continue;
      const exists = await fsp.access(candidate).then(() => true, () => false);
      if (exists || this.claimedOutputs.has(key)) continue;
      this.claimedOutputs.add(key);
      return candidate;
    }
    return outputFile;
  }

  /** Refuses jobs that could never produce a sane result, before any process is started. */
  _validateJob(jobConfig) {
    if (!jobConfig || typeof jobConfig !== 'object') return 'Invalid job.';
    const { jobId, inputFile, outputFile } = jobConfig;
    if (typeof jobId !== 'string' || !/^[\w-]{1,80}$/.test(jobId)) return 'Invalid job id.';
    if (this.runningJobs.has(jobId)) return 'This job is already running.';
    if (typeof inputFile !== 'string' || !path.isAbsolute(inputFile)) return 'Invalid input file.';
    if (typeof outputFile !== 'string' || !path.isAbsolute(outputFile)) return 'Invalid output file.';
    if (!isOutputExtension(path.extname(outputFile))) return `Unsupported output format: ${path.extname(outputFile) || 'none'}.`;
    if (path.resolve(inputFile).toLowerCase() === path.resolve(outputFile).toLowerCase()) {
      return 'The output file cannot overwrite the source file.';
    }
    return null;
  }

  /** Validates a frame blending request against the real source and picks the filtergraph engine. */
  async _resolveFrameBlend(jobConfig) {
    const options = jobConfig.options || {};
    if (jobConfig.mode !== 'trim' || !options.frameBlend || options.isAudioOnly || options.exportAsGif) return null;

    const info = await this.ffmpegManager.probe(jobConfig.inputFile);
    if (!info.video) throw new Error('Frame blending needs a video stream.');
    const plan = frameBlend.planFrameBlend({ sourceFps: info.video.frameBlend.sourceFps, speed: num(options.speed, 0.25, 4, 1) });
    if (!plan.ok) throw new Error(`Frame blending is not available for this clip. ${plan.reason}`);

    const engine = plan.blend ? await this.ffmpegManager.getBlendEngine() : null;
    this.logDebug('FFMPEG', `Frame blending ${frameBlend.describeBlend(plan)} [${jobConfig.jobId}]`, {
      sourceFps: plan.sourceFps,
      outputFps: plan.outputFps,
      engine,
    });
    return { plan, engine };
  }

  /**
   * Which audio tracks (in `0:a:N` order) go into the output and how.
   * Returns null for FFmpeg's default pick (one track), which needs no explicit mapping.
   */
  async _resolveAudioTracks(jobConfig) {
    const options = jobConfig.options || {};
    const request = options.audioTracks;
    if (options.muteAudio || options.exportAsGif || !request || !['first', 'keep', 'merge'].includes(request.mode)) return null;

    let count = 0;
    try {
      const info = await this.ffmpegManager.probe(jobConfig.inputFile);
      count = (info.audioTracks || []).length;
    } catch {
      return null;
    }
    if (count === 0) return null;

    const all = Array.from({ length: count }, (_, i) => i);
    let include = all;
    if (request.mode === 'first') include = [0];
    else if (Array.isArray(request.include)) include = all.filter((i) => request.include.includes(i));

    let mode = request.mode === 'merge' ? 'merge' : 'keep';
    // MP3, WAV and friends carry a single stream: several chosen tracks have to be mixed.
    if (options.isAudioOnly && SINGLE_AUDIO_STREAM.includes(path.extname(jobConfig.outputFile).toLowerCase())) mode = 'merge';
    if (include.length <= 1) mode = 'keep';
    return { mode, include };
  }

  /**
   * Audio selection and filtering as FFmpeg arguments.
   * @param filters audio filters to apply (gain, tempo, loudness)
   * @returns {{ maps: string[], graph: string|null, args: string[], explicit: boolean, none: boolean }}
   *   `graph` is a filter_complex chain producing [aout] (merge mode), `args` the per-stream
   *   filter arguments, `explicit` whether the video has to be mapped explicitly too.
   */
  _audioPlan(tracks, filters) {
    const filterArgs = filters.length > 0 ? ['-af', filters.join(',')] : [];
    if (!tracks) return { maps: [], graph: null, args: filterArgs, explicit: false, none: false };
    if (tracks.include.length === 0) return { maps: [], graph: null, args: [], explicit: true, none: true };

    if (tracks.mode === 'merge') {
      const inputs = tracks.include.map((i) => `[0:a:${i}]`).join('');
      const chain = [`amix=inputs=${tracks.include.length}:duration=longest:dropout_transition=0:normalize=0`, ...filters];
      return { maps: ['-map', '[aout]'], graph: `${inputs}${chain.join(',')}[aout]`, args: [], explicit: true, none: false };
    }
    const maps = tracks.include.flatMap((i) => ['-map', `0:a:${i}`]);
    return { maps, graph: null, args: filterArgs, explicit: true, none: false };
  }

  /** `-hwaccel auto` when GPU decoding is enabled; the software retry never uses it. */
  _decodeArgs(softwareOnly) {
    return this.engine.hwDecode && !softwareOnly ? ['-hwaccel', 'auto'] : [];
  }

  async _runSinglePass(ffmpegPath, jobConfig, callbacks, context) {
    const options = jobConfig.options || {};
    const speed = jobConfig.mode === 'trim' ? num(options.speed, 0.25, 4, 1) : 1;
    const totalDuration = (num(jobConfig.duration, 0, 1e7, 0) || num(options.customDuration, 0, 1e7, 0)) / speed;

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
    const usedHardware = run.args.some((arg) => HARDWARE_ENCODER.test(arg)) || run.args.includes('-hwaccel');
    // GPU encoders and decoders fail for reasons the CPU does not share (driver, session limit,
    // unsupported input). The error is at the end of the log, so unrelated late failures are not retried.
    if (run.code !== 0 && usedHardware && !this.canceledJobs.has(jobConfig.jobId) && HARDWARE_FAILURE.test(run.log.slice(-1500))) {
      this.logDebug('FFMPEG', `Hardware encoder failed. Falling back to software encoding for [${jobConfig.jobId}]`);
      if (callbacks.onLog) callbacks.onLog('\n[itzCut] Hardware encoder failed, retrying with software encoding...\n');
      run = await attempt(true);
    }
    return run;
  }

  /**
   * TikTok profile: genuine two-pass x264 VBR (20 Mbps average, 40 Mbps peak) at a constant frame
   * rate. Always the software encoder: GPU encoders have no real two-pass mode.
   */
  async _runTwoPass(ffmpegPath, jobConfig, callbacks, scratchFiles, context) {
    const { jobId, inputFile, outputFile } = jobConfig;
    const options = jobConfig.options || {};
    const totalDuration = num(jobConfig.duration, 0, 1e7, 0) || num(options.customDuration, 0, 1e7, 0);
    const passLogPrefix = path.join(os.tmpdir(), `itzcut_passlog_${process.pid}_${jobId}`);
    scratchFiles.push(...passLogFiles(passLogPrefix));

    // Both passes must share the preset: x264 rejects a second pass whose frame-type settings
    // (B-frames, lookahead) differ from the statistics file.
    const video = [
      '-c:v', 'libx264', '-profile:v', 'main', '-refs', '4',
      '-b:v', '20M', '-maxrate', '40M', '-bufsize', '40M',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'cfr',
      '-preset', presetName(options.preset),
      '-passlogfile', passLogPrefix,
    ];
    const runPass = (pass, tail, percentRange) => {
      const args = [...BASE_ARGS, '-i', inputFile, ...tail.pre, ...video, '-pass', String(pass), ...tail.post];
      this.logDebug('FFMPEG', `Starting TikTok Pass ${pass} [${jobId}]`, { args: args.join(' ') });
      return this._runFfmpeg(ffmpegPath, jobId, args, { ...callbacks, totalDuration, percentRange, pass });
    };

    if (callbacks.onProgress) callbacks.onProgress({ percent: 1 });
    const analysis = await runPass(1, { pre: ['-map', '0:v:0'], post: ['-an', '-f', 'null', NULL_DEVICE] }, [0, 50]);
    if (analysis.code !== 0 || this.canceledJobs.has(jobId)) {
      return { ...analysis, failure: `FFmpeg pass 1 failed with code ${analysis.code}.` };
    }

    const boostDb = num(options.audioBoostDb, 0, 30, 0);
    const audio = options.muteAudio
      ? { maps: [], graph: null, args: [], none: true }
      : this._audioPlan(context.audioTracks, boostDb > 0 ? [`volume=${boostDb}dB`] : []);
    const pre = [...(audio.graph ? ['-filter_complex', audio.graph] : []), '-map', '0:v:0', ...(audio.none ? [] : audio.maps.length ? audio.maps : ['-map', '0:a:0?'])];
    const post = [
      ...(audio.none ? ['-an'] : [...audio.args, '-c:a', 'aac', '-b:a', '192k']),
      ...metadataArgs(options.stripMetadata),
      '-movflags', '+faststart',
      outputFile,
    ];
    const encode = await runPass(2, { pre, post }, [50, 100]);
    return { ...encode, failure: `FFmpeg pass 2 failed with code ${encode.code}.` };
  }

  _applyPriority(proc) {
    const priority = PROCESS_PRIORITY[this.engine.priority];
    if (!proc || !proc.pid || priority === undefined) return;
    try {
      os.setPriority(proc.pid, priority);
    } catch {
      // The process may already have exited.
    }
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
      if (this.engine.priority !== 'normal') this._applyPriority(proc);
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
        const percent = Math.min(to - 0.5, Math.round((from + fraction * (to - from)) * 10) / 10);
        const encodeSpeed = progress.speed ? parseFloat(progress.speed) : 1;
        onProgress({
          percent,
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

  /**
   * FFmpeg arguments for a job.
   * @param softwareOnly skip the GPU encoders and decoders (used when a hardware attempt failed)
   * @param context values resolved asynchronously before the job starts ({ frameBlend, audioTracks })
   */
  buildArgs(jobConfig, softwareOnly = false, context = {}) {
    if (jobConfig.mode === 'trim') return this._buildTrimArgs(jobConfig, softwareOnly, context);
    if (jobConfig.mode === 'compress') return this._buildCompressArgs(jobConfig, softwareOnly, context);
    if (jobConfig.mode === 'convert') return this._buildConvertArgs(jobConfig, softwareOnly, context);

    const options = jobConfig.options || {};
    return [...BASE_ARGS, '-i', jobConfig.inputFile, ...(options.stripMetadata ? [] : BRAND_METADATA), '-c', 'copy', jobConfig.outputFile];
  }

  _buildTrimArgs(jobConfig, softwareOnly, context) {
    const { inputFile, outputFile } = jobConfig;
    const options = jobConfig.options || {};
    const start = num(options.start, 0, 1e7, 0);
    const end = num(options.end, 0, 1e7, 0);
    const speed = num(options.speed, 0.25, 4, 1);
    const rotation = ROTATION_FILTERS[options.rotation] ? options.rotation : 'none';
    const canvasFit = CANVAS_FITS.includes(options.canvasFit) ? options.canvasFit : 'pad';
    const boostDb = num(options.audioBoostDb, 0, 30, 0);
    const gifFps = num(options.gifFps, 1, 50, 15);
    const blend = context.frameBlend || null;
    const outExt = path.extname(outputFile).toLowerCase();

    const canvas = options.aspectRatio && options.aspectRatio !== 'original' ? ASPECT_CANVASES[options.aspectRatio] || ASPECT_CANVASES['16:9'] : null;
    const needsVideoEncode = speed !== 1 || rotation !== 'none' || canvas !== null || !!options.exportAsGif || blend !== null;
    const tracks = options.muteAudio ? null : context.audioTracks || null;
    const needsAudioEncode = boostDb > 0 || !!options.loudnorm || speed !== 1 || (tracks !== null && tracks.mode === 'merge');
    const decode = needsVideoEncode && !options.isAudioOnly ? this._decodeArgs(softwareOnly) : [];

    const args = [...BASE_ARGS, ...decode];
    if (start > 0) args.push('-ss', String(start));
    if (end > start) args.push('-to', String(end));
    args.push('-i', inputFile);

    const audioFilters = [];
    if (speed !== 1) audioFilters.push(`atempo=${speed}`);
    if (boostDb > 0) audioFilters.push(`volume=${boostDb}dB`);
    if (options.loudnorm) audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    const audio = options.muteAudio ? { maps: [], graph: null, args: [], explicit: false, none: true } : this._audioPlan(tracks, audioFilters);

    if (options.isAudioOnly) {
      const codec = AUDIO_CODEC_BY_EXTENSION[outExt] || ['-c:a', 'aac', '-b:a', '192k'];
      // Stream copy keeps the source codec, which only works while nothing is filtered.
      const copy = options.losslessCopy && !needsAudioEncode && !audio.graph;
      if (audio.graph) args.push('-filter_complex', audio.graph);
      args.push(...audio.maps, '-vn', ...audio.args, ...(copy ? ['-c:a', 'copy'] : codec), ...metadataArgs(options.stripMetadata), outputFile);
      return args;
    }

    if (options.exportAsGif) {
      args.push(...gifFilterArgs(gifFps), outputFile);
      return args;
    }

    const audioCodec = audio.none ? ['-an'] : [...audio.args, ...defaultAudioCodec(outputFile)];

    // Stream copy is possible while the picture is untouched: the audio alone is re-encoded when
    // it is filtered or mixed, which keeps lossless cuts of multi-hour recordings instant.
    if (options.losslessCopy && !needsVideoEncode) {
      if (audio.graph) args.push('-filter_complex', audio.graph);
      if (audio.explicit) args.push('-map', '0:v:0?', ...audio.maps);
      args.push('-c:v', 'copy', ...(audio.none ? ['-an'] : needsAudioEncode ? audioCodec : ['-c:a', 'copy']));
      // Subtitles and data streams are not carried over by the explicit mapping above.
      args.push(...metadataArgs(options.stripMetadata), outputFile);
      return args;
    }

    // Geometry runs after blending: the result is identical (both are linear) and four times
    // fewer frames go through the scaler.
    const geometry = [];
    if (ROTATION_FILTERS[rotation]) geometry.push(ROTATION_FILTERS[rotation]);
    if (canvas) geometry.push(scaleToCanvas(canvas, canvasFit));

    const graphs = [];
    let videoMap = '0:v:0';
    if (blend) {
      // A microsecond timebase keeps the retimed timestamps exact before they are conformed.
      const retime = speed !== 1 ? `settb=AVTB,setpts=PTS/${speed},` : '';
      const graph = frameBlend.buildBlendGraph(blend.plan, { engine: blend.engine, input: `[0:v:0]${retime}` });
      graphs.push(`${[graph, ...geometry].join(',')}[vout]`);
      videoMap = '[vout]';
    }
    if (audio.graph) graphs.push(audio.graph);
    if (graphs.length > 0) args.push('-filter_complex', graphs.join(';'));

    if (!blend) {
      const filters = [...(speed !== 1 ? [`setpts=${1 / speed}*PTS`] : []), ...geometry];
      if (filters.length > 0) args.push('-vf', filters.join(','));
    }
    // A labeled video output disables FFmpeg's automatic stream selection, so audio is mapped too.
    if (blend || audio.explicit) args.push('-map', videoMap, ...(audio.explicit ? audio.maps : audio.none ? [] : ['-map', '0:a:0?']));

    args.push(
      ...qualityEncoderArgs(this.getPreferredVideoEncoder('libx264', softwareOnly), 19, ['-c:v', 'libx264', '-crf', '19', '-preset', 'fast', '-pix_fmt', 'yuv420p'], 'fast')
    );
    args.push(...audioCodec);
    args.push(...metadataArgs(options.stripMetadata), ...fastStartArgs(outputFile));

    // The blend graph pads the tail so the last frames are fully mixed; cut back to the clip length.
    if (blend && end > start) args.push('-t', ((end - start) / speed).toFixed(6));

    args.push(outputFile);
    return args;
  }

  /** Picture filters shared by compress and convert: scaling, then the frame rate mode. */
  _videoFilterArgs(options, isVfr) {
    const filters = [];
    const targetRes = this.parseResolution(options.resolution, options.customResolution);
    if (targetRes) filters.push(scaleToCanvas(targetRes, CANVAS_FITS.includes(options.canvasFit) ? options.canvasFit : 'pad'));
    filters.push(...frameRateFilters(frameRate(options.fps), isVfr));
    return filters.length > 0 ? ['-vf', filters.join(',')] : [];
  }

  /** Mapping and filter arguments for the audio of compress / convert jobs. */
  _mappedAudio(options, context, codecArgs) {
    if (options.muteAudio) return { pre: [], post: ['-an'] };
    const boostDb = num(options.audioBoostDb, 0, 30, 0);
    const audio = this._audioPlan(context.audioTracks || null, boostDb > 0 ? [`volume=${boostDb}dB`] : []);
    if (audio.none) return { pre: ['-map', '0:v:0'], post: ['-an'] };
    const pre = [...(audio.graph ? ['-filter_complex', audio.graph] : []), ...(audio.explicit ? ['-map', '0:v:0', ...audio.maps] : [])];
    return { pre, post: [...audio.args, ...codecArgs] };
  }

  _buildCompressArgs(jobConfig, softwareOnly, context = {}) {
    const { inputFile, outputFile } = jobConfig;
    const options = jobConfig.options || {};
    const preset = presetName(options.preset);
    const crf = Math.round(num(options.crf, 0, 51, 24));
    const duration = num(jobConfig.duration, 0, 1e7, 0);
    const args = [...BASE_ARGS, ...this._decodeArgs(softwareOnly), '-i', inputFile];
    const encoder = this.getPreferredVideoEncoder('libx264', softwareOnly);
    const isVfr = options.fpsMode === 'vfr';
    let audioCodec;

    if (options.type === 'target_size' || options.type === 'discord') {
      const seconds = duration > 0 ? duration : 60;
      const targetSizeMB = num(options.targetSizeMB, 1, 100000, 25);
      const totalBits = targetSizeMB * 8 * 1024 * 1024 * 0.96;
      const audioKbps = options.muteAudio ? 0 : 96;
      const videoBits = Math.max(totalBits - audioKbps * 1000 * seconds, totalBits * 0.5);
      const videoKbps = Math.max(50, Math.floor(videoBits / seconds / 1000));
      const rate = ['-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.35)}k`, '-bufsize', `${Math.round(videoKbps * 2)}k`];

      if (encoder.isHardware) {
        args.push('-c:v', encoder.encoder, ...hardwarePresetArgs(encoder, preset), ...rate, ...(encoder.type === 'qsv' ? [] : ['-pix_fmt', 'yuv420p']));
      } else {
        args.push('-c:v', 'libx264', ...rate, '-preset', preset, '-pix_fmt', 'yuv420p');
      }
      audioCodec = ['-c:a', 'aac', '-b:a', `${audioKbps}k`];
    } else {
      const software = ['-c:v', 'libx264', '-crf', String(crf), '-fastfirstpass', '1', '-preset', preset, '-pix_fmt', 'yuv420p'];
      args.push(...qualityEncoderArgs(encoder, crf, software, preset));
      const audioBitrate = bitrate(options.audioBitrate);
      audioCodec = audioBitrate ? ['-c:a', 'aac', '-b:a', audioBitrate] : ['-c:a', 'aac', '-b:a', '192k'];
    }

    const audio = this._mappedAudio(options, context, audioCodec);
    args.splice(args.indexOf('-i') + 2, 0, ...audio.pre);
    args.push(...audio.post, ...this._videoFilterArgs(options, isVfr));
    args.push(...frameRateModeArgs(isVfr, encoder.isHardware ? encoder.encoder : 'libx264', outputFile));
    args.push(...metadataArgs(options.stripMetadata), ...fastStartArgs(outputFile), outputFile);
    return args;
  }

  _buildConvertArgs(jobConfig, softwareOnly, context = {}) {
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
    if (!VIDEO_CODECS.includes(options.videoCodec)) options.videoCodec = 'libx264';
    if (!AUDIO_CODECS.includes(options.audioCodec)) options.audioCodec = 'aac';
    options.crf = Math.round(num(options.crf, 0, 51, 22));
    options.audioBitrate = bitrate(options.audioBitrate);
    options.videoBitrate = bitrate(options.videoBitrate);

    const outExt = path.extname(outputFile).toLowerCase();
    const boostDb = num(options.audioBoostDb, 0, 30, 0);
    const isGif = options.format === 'gif';
    const decode = options.audioOnly || isGif ? [] : this._decodeArgs(softwareOnly);
    const args = [...BASE_ARGS, ...decode, '-i', inputFile];

    if (options.audioOnly) {
      args.push('-vn', ...this._convertAudioOnlyArgs(options, outExt, boostDb, context));
    } else if (isGif) {
      const fps = frameRate(options.fps);
      args.push(...gifFilterArgs(fps === 'original' ? 15 : Math.min(50, parseFloat(fps))));
    } else {
      args.push(...this._convertVideoArgs(options, outputFile, softwareOnly, boostDb, context));
    }

    args.push(...metadataArgs(options.stripMetadata));
    if (!options.audioOnly) args.push(...fastStartArgs(outputFile));
    args.push(outputFile);
    return args;
  }

  _convertAudioOnlyArgs(options, outExt, boostDb, context) {
    const { audioCodec, audioBitrate } = options;
    const filters = boostDb > 0 && audioCodec !== 'copy' ? [`volume=${boostDb}dB`] : [];
    const tracks = context.audioTracks && audioCodec !== 'copy' ? context.audioTracks : null;
    const audio = this._audioPlan(tracks ? { ...tracks, mode: SINGLE_AUDIO_STREAM.includes(outExt) && tracks.include.length > 1 ? 'merge' : tracks.mode } : null, filters);

    const args = [...(audio.graph ? ['-filter_complex', audio.graph] : []), ...audio.maps, ...audio.args];
    const sampleRate = num(options.sampleRate, 8000, 192000, 0);
    const channels = num(options.channels, 1, 8, 0);
    if (sampleRate) args.push('-ar', String(Math.round(sampleRate)));
    if (channels) args.push('-ac', String(Math.round(channels)));
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

  _convertVideoArgs(options, outputFile, softwareOnly, boostDb, context) {
    const { videoCodec, videoBitrate, crf } = options;
    const outExt = path.extname(outputFile).toLowerCase();
    const preset = presetName(options.preset);
    const args = [];
    const isX26x = videoCodec.includes('x264') || videoCodec.includes('x265');
    const encoder = this.getPreferredVideoEncoder(videoCodec, softwareOnly);
    let activeEncoder = videoCodec;

    if (videoBitrate) {
      activeEncoder = encoder.isHardware && isX26x ? encoder.encoder : videoCodec;
      args.push('-c:v', activeEncoder, '-b:v', videoBitrate, ...(activeEncoder !== videoCodec ? ['-pix_fmt', 'yuv420p'] : []));
    } else if (isX26x) {
      activeEncoder = encoder.encoder;
      const software = ['-c:v', videoCodec, '-crf', String(crf), ...(videoCodec.includes('x264') ? ['-fastfirstpass', '1'] : []), '-preset', preset, '-pix_fmt', 'yuv420p'];
      args.push(...qualityEncoderArgs(encoder, crf, software, preset));
    } else if (videoCodec === 'libvpx-vp9') {
      // VP9's quality scale sits about nine steps above x264's; row-mt and cpu-used 4 make the
      // encoder use every core instead of its single-threaded, near-archival default.
      args.push('-c:v', videoCodec, '-crf', String(Math.min(63, crf + 9)), '-b:v', '0', '-row-mt', '1', '-cpu-used', '4');
    } else {
      args.push('-c:v', videoCodec);
    }

    // QuickTime and iOS only play HEVC in MP4/MOV when it is tagged hvc1.
    if (/hevc|265/.test(activeEncoder) && FASTSTART_CONTAINERS.includes(outExt)) args.push('-tag:v', 'hvc1');

    const isVfr = options.fpsMode === 'vfr';
    args.push(...this._videoFilterArgs(options, isVfr));
    args.push(...frameRateModeArgs(isVfr, activeEncoder, outputFile));

    if (options.muteAudio) return [...args, '-an'];

    // WebM only carries Opus or Vorbis audio.
    const audioCodec = outExt === '.webm' && !['libopus', 'libvorbis', 'copy'].includes(options.audioCodec) ? 'libopus' : options.audioCodec;
    const codecArgs = ['-c:a', audioCodec, ...(options.audioBitrate && audioCodec !== 'copy' ? ['-b:a', options.audioBitrate] : [])];
    const audio = this._mappedAudio({ ...options, audioBoostDb: boostDb }, context, codecArgs);
    return [...audio.pre, ...args, ...audio.post];
  }

  formatSeconds(seconds) {
    return formatSeconds(seconds);
  }
}

module.exports = Transcoder;
module.exports.frameRateFilters = frameRateFilters;
