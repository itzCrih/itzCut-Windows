const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class Transcoder {
  constructor(ffmpegManager) {
    this.ffmpegManager = ffmpegManager;
    this.activeJobs = new Map(); // jobId -> childProcess
    this.canceledJobs = new Set(); // jobId
    this.debugLogger = null;
  }

  setDebugLogger(fn) {
    this.debugLogger = fn;
  }

  logDebug(category, message, details = null) {
    if (this.debugLogger) {
      this.debugLogger(category, message, details);
    }
  }

  cancelJob(jobId) {
    this.canceledJobs.add(jobId);
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.isCanceled = true;
      try {
        job.process.kill('SIGKILL');
      } catch (e) {}
      this.activeJobs.delete(jobId);

      // Clean up pass log files if any
      if (job.passLogPrefix) {
        try {
          const files = [
            `${job.passLogPrefix}-0.log`,
            `${job.passLogPrefix}-0.log.mbtree`,
            `${job.passLogPrefix}-0.log.mbtree.temp`,
          ];
          for (const f of files) {
            if (fs.existsSync(f)) fs.unlinkSync(f);
          }
        } catch (e) {}
      }

      // Delete the working / partial video file immediately
      if (job.outputFile && fs.existsSync(job.outputFile)) {
        try {
          fs.unlinkSync(job.outputFile);
        } catch (e) {}
      }
      return true;
    }
    return false;
  }

  getPreferredVideoEncoder(requestedCodec = 'libx264', isRetrySoftware = false) {
    if (isRetrySoftware) {
      const isHevc = requestedCodec.includes('x265') || requestedCodec.includes('hevc');
      return { encoder: isHevc ? 'libx265' : 'libx264', isHardware: false };
    }

    const accels = (this.ffmpegManager && this.ffmpegManager.status && this.ffmpegManager.status.hardwareAccels) || {};

    if (requestedCodec.includes('x265') || requestedCodec.includes('hevc')) {
      if (accels.nvenc) return { encoder: 'hevc_nvenc', isHardware: true, type: 'nvenc' };
      if (accels.qsv) return { encoder: 'hevc_qsv', isHardware: true, type: 'qsv' };
      if (accels.amf) return { encoder: 'hevc_amf', isHardware: true, type: 'amf' };
      return { encoder: 'libx265', isHardware: false };
    }

    // Default H.264: Force GPU when available
    if (accels.nvenc) return { encoder: 'h264_nvenc', isHardware: true, type: 'nvenc' };
    if (accels.qsv) return { encoder: 'h264_qsv', isHardware: true, type: 'qsv' };
    if (accels.amf) return { encoder: 'h264_amf', isHardware: true, type: 'amf' };

    return { encoder: 'libx264', isHardware: false };
  }

  async runJob(jobConfig, callbacks, isRetrySoftware = false) {
    const { onProgress, onComplete, onError, onLog } = callbacks;
    const { jobId, outputFile, duration = 0, options = {} } = jobConfig;

    if (options.type === 'tiktok') {
      return this.runTikTokTwoPass(jobConfig, callbacks);
    }

    if (!this.ffmpegManager.ffmpegPath) {
      await this.ffmpegManager.detect();
    }
    const ffmpegPath = this.ffmpegManager.ffmpegPath;
    if (!ffmpegPath) {
      throw new Error('FFmpeg not found. Please install or download FFmpeg before processing.');
    }

    // Ensure output directory exists
    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const args = this.buildArgs(jobConfig, isRetrySoftware);
    this.logDebug('FFMPEG', `Starting ${jobConfig.mode || 'job'} [${jobId}]`, {
      outputFile,
      isSoftwareFallback: isRetrySoftware,
      args: args.join(' '),
    });

    return new Promise((resolve, reject) => {
      // Spawn with standard high-performance settings
      const proc = spawn(ffmpegPath, args);
      this.activeJobs.set(jobId, { process: proc, outputFile });

      let logBuffer = '';
      const totalDurationSec = duration || (options && options.customDuration) || 0;

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        logBuffer += text;
        if (onLog) onLog(text);

        // Parse FFmpeg progress
        const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
        const fpsMatch = text.match(/fps=\s*(\d+(\.\d+)?)/);
        const speedMatch = text.match(/speed=\s*(\d+(\.\d+)?)x/);
        const bitrateMatch = text.match(/bitrate=\s*([\d\.]+\s*\w+\/s)/);

        if (timeMatch) {
          const hours = parseFloat(timeMatch[1]);
          const minutes = parseFloat(timeMatch[2]);
          const seconds = parseFloat(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;

          let percent = 0;
          let eta = null;

          if (totalDurationSec > 0) {
            percent = Math.min(99.5, Math.round((currentTime / totalDurationSec) * 1000) / 10);
            const speed = speedMatch ? parseFloat(speedMatch[1]) : 1.0;
            if (speed > 0) {
              const remainingSec = Math.max(0, (totalDurationSec - currentTime) / speed);
              eta = this.formatSeconds(remainingSec);
            }
          }

          if (onProgress) {
            onProgress({
              percent,
              currentTime: this.formatSeconds(currentTime),
              currentSeconds: currentTime,
              totalTime: this.formatSeconds(totalDurationSec),
              fps: fpsMatch ? fpsMatch[1] : null,
              speed: speedMatch ? `${speedMatch[1]}x` : null,
              bitrate: bitrateMatch ? bitrateMatch[1] : null,
              eta,
            });
          }
        }
      });

      proc.on('close', async (code) => {
        this.activeJobs.delete(jobId);

        if (this.canceledJobs.has(jobId)) {
          this.canceledJobs.delete(jobId);
          if (fs.existsSync(outputFile)) {
            try { fs.unlinkSync(outputFile); } catch (e) {}
          }
          this.logDebug('FFMPEG', `Job canceled cleanly by user [${jobId}]`);
          resolve({ jobId, canceled: true, success: false });
          return;
        }

        if (code === 0) {
          let outputSize = 0;
          try {
            if (fs.existsSync(outputFile)) {
              outputSize = fs.statSync(outputFile).size;
            }
          } catch (e) {}

          const result = {
            jobId,
            outputPath: outputFile,
            outputSize,
            success: true,
          };
          this.logDebug('FFMPEG', `Job completed successfully [${jobId}]`, { outputSize });
          if (onProgress) onProgress({ percent: 100 });
          if (onComplete) onComplete(result);
          resolve(result);
        } else {
          // Check for hardware acceleration failure for auto-fallback to CPU libx264
          const isHwFailure =
            !isRetrySoftware &&
            (logBuffer.includes('CUDA') ||
              logBuffer.includes('nvenc') ||
              logBuffer.includes('qsv') ||
              logBuffer.includes('amf') ||
              logBuffer.includes('Cannot load nvcuda') ||
              logBuffer.includes('Device creation failed') ||
              logBuffer.includes('Error while opening encoder') ||
              logBuffer.includes('Hardware accelerator'));

          if (isHwFailure) {
            this.logDebug('FFMPEG', `Hardware encoder failed. Falling back to universal software libx264 for [${jobId}]`);
            try {
              const retryRes = await this.runJob(jobConfig, callbacks, true);
              resolve(retryRes);
              return;
            } catch (retryErr) {
              // Failed even in fallback
            }
          }

          const err = new Error(`FFmpeg exited with error code ${code}.`);
          err.log = logBuffer;
          this.logDebug('FFMPEG', `Job failed with code ${code} [${jobId}]`, { errorSnippet: logBuffer.slice(-300) });
          if (onError) onError(err);
          reject(err);
        }
      });

      proc.on('error', (err) => {
        this.activeJobs.delete(jobId);
        if (this.canceledJobs.has(jobId)) {
          this.canceledJobs.delete(jobId);
          if (fs.existsSync(outputFile)) {
            try { fs.unlinkSync(outputFile); } catch (e) {}
          }
          resolve({ jobId, canceled: true, success: false });
          return;
        }
        this.logDebug('FFMPEG', `Spawn error on [${jobId}]: ${err.message}`);
        if (onError) onError(err);
        reject(err);
      });
    });
  }

  async runTikTokTwoPass(jobConfig, callbacks) {
    const { onProgress, onComplete, onError, onLog } = callbacks;
    const { jobId, inputFile, outputFile, duration = 0, options = {} } = jobConfig;

    if (!this.ffmpegManager.ffmpegPath) {
      await this.ffmpegManager.detect();
    }
    const ffmpegPath = this.ffmpegManager.ffmpegPath;
    if (!ffmpegPath) {
      throw new Error('FFmpeg not found. Please install or download FFmpeg before processing.');
    }

    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const passLogPrefix = path.join(outputDir, `passlog_${jobId}`);
    const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const totalDurationSec = duration || (options && options.customDuration) || 0;

    const cleanupLogs = () => {
      const files = [
        `${passLogPrefix}-0.log`,
        `${passLogPrefix}-0.log.mbtree`,
        `${passLogPrefix}-0.log.mbtree.temp`,
      ];
      for (const f of files) {
        try {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        } catch (e) {}
      }
    };

    const runPass = (passNumber, args) => {
      return new Promise((resolve, reject) => {
        this.logDebug('FFMPEG', `Starting TikTok Pass ${passNumber} [${jobId}]`, { args: args.join(' ') });
        const proc = spawn(ffmpegPath, args);
        this.activeJobs.set(jobId, { process: proc, outputFile, passLogPrefix });

        let logBuffer = '';

        proc.stderr.on('data', (data) => {
          const text = data.toString();
          logBuffer += text;
          if (onLog) onLog(text);

          const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
          const fpsMatch = text.match(/fps=\s*(\d+(\.\d+)?)/);
          const speedMatch = text.match(/speed=\s*(\d+(\.\d+)?)x/);
          const bitrateMatch = text.match(/bitrate=\s*([\d\.]+\s*\w+\/s)/);

          if (timeMatch && totalDurationSec > 0) {
            const hours = parseFloat(timeMatch[1]);
            const minutes = parseFloat(timeMatch[2]);
            const seconds = parseFloat(timeMatch[3]);
            const currentTime = hours * 3600 + minutes * 60 + seconds;

            const passPercent = Math.min(100, (currentTime / totalDurationSec) * 100);
            const overallPercent = passNumber === 1
              ? Math.min(49.5, Math.round((passPercent * 0.5) * 10) / 10)
              : Math.min(99.5, Math.round((50 + passPercent * 0.5) * 10) / 10);

            if (onProgress) {
              onProgress({
                percent: overallPercent,
                currentTime: this.formatSeconds(currentTime),
                currentSeconds: currentTime,
                totalTime: this.formatSeconds(totalDurationSec),
                fps: fpsMatch ? fpsMatch[1] : null,
                speed: speedMatch ? `${speedMatch[1]}x` : null,
                bitrate: bitrateMatch ? bitrateMatch[1] : null,
                pass: passNumber,
              });
            }
          }
        });

        proc.on('close', (code) => {
          if (this.canceledJobs.has(jobId)) {
            return resolve({ canceled: true });
          }
          if (code === 0) {
            resolve();
          } else {
            const err = new Error(`FFmpeg pass ${passNumber} failed with code ${code}.`);
            err.log = logBuffer;
            reject(err);
          }
        });

        proc.on('error', (err) => {
          if (this.canceledJobs.has(jobId)) {
            return resolve({ canceled: true });
          }
          reject(err);
        });
      });
    };

    try {
      if (onProgress) onProgress({ percent: 1 });

      // Pass 1: Analysis (audio stripped, output to NUL)
      const pass1Args = [
        '-y',
        '-hide_banner',
        '-threads', '0',
        '-i', inputFile,
        '-c:v', 'libx264',
        '-profile:v', 'main',
        '-refs', '4',
        '-b:v', '20M',
        '-maxrate', '40M',
        '-bufsize', '40M',
        '-pix_fmt', 'yuv420p',
        '-fps_mode', 'cfr',
        '-pass', '1',
        '-passlogfile', passLogPrefix,
        '-an',
        '-f', 'null',
        nullOutput,
      ];
      await runPass(1, pass1Args);

      if (this.canceledJobs.has(jobId)) {
        this.canceledJobs.delete(jobId);
        cleanupLogs();
        if (fs.existsSync(outputFile)) {
          try { fs.unlinkSync(outputFile); } catch (e) {}
        }
        return { jobId, canceled: true, success: false };
      }

      // Pass 2: Final encode with audio & faststart
      const pass2Args = [
        '-y',
        '-hide_banner',
        '-threads', '0',
        '-i', inputFile,
        '-c:v', 'libx264',
        '-profile:v', 'main',
        '-refs', '4',
        '-b:v', '20M',
        '-maxrate', '40M',
        '-bufsize', '40M',
        '-pix_fmt', 'yuv420p',
        '-fps_mode', 'cfr',
        '-pass', '2',
        '-passlogfile', passLogPrefix,
        '-preset', options.preset || 'medium',
      ];

      const boostVal = parseFloat(options.audioBoostDb) || 0;
      if (options.muteAudio) {
        pass2Args.push('-an');
      } else {
        if (boostVal > 0) {
          pass2Args.push('-af', `volume=${boostVal}dB`);
        }
        pass2Args.push('-c:a', 'aac', '-b:a', '192k');
      }

      if (options.stripMetadata) {
        pass2Args.push('-map_metadata', '-1');
      } else {
        pass2Args.push(
          '-metadata', 'comment=Encoded by cut.itzcrih.it',
          '-metadata', 'description=Encoded by cut.itzcrih.it'
        );
      }

      pass2Args.push('-movflags', '+faststart', outputFile);
      await runPass(2, pass2Args);

      if (this.canceledJobs.has(jobId)) {
        this.canceledJobs.delete(jobId);
        cleanupLogs();
        if (fs.existsSync(outputFile)) {
          try { fs.unlinkSync(outputFile); } catch (e) {}
        }
        return { jobId, canceled: true, success: false };
      }

      cleanupLogs();
      this.activeJobs.delete(jobId);

      let outputSize = 0;
      try {
        if (fs.existsSync(outputFile)) {
          outputSize = fs.statSync(outputFile).size;
        }
      } catch (e) {}

      const result = {
        jobId,
        outputPath: outputFile,
        outputSize,
        success: true,
      };

      this.logDebug('FFMPEG', `TikTok 2-pass completed successfully [${jobId}]`, { outputSize });
      if (onProgress) onProgress({ percent: 100 });
      if (onComplete) onComplete(result);
      return result;
    } catch (err) {
      cleanupLogs();
      this.activeJobs.delete(jobId);
      if (this.canceledJobs.has(jobId)) {
        this.canceledJobs.delete(jobId);
        if (fs.existsSync(outputFile)) {
          try { fs.unlinkSync(outputFile); } catch (e) {}
        }
        return { jobId, canceled: true, success: false };
      }
      this.logDebug('FFMPEG', `TikTok 2-pass failed [${jobId}]`, { error: err.message });
      if (onError) onError(err);
      throw err;
    }
  }

  buildArgs(jobConfig, isRetrySoftware = false) {
    const { inputFile, outputFile, mode, options = {}, duration = 0 } = jobConfig;
    // Enable multi-threading (-threads 0) for maximum CPU utilization
    const args = ['-y', '-hide_banner', '-threads', '0'];

    // 1. TRIMMER MODE
    if (mode === 'trim') {
      const {
        start = 0,
        end = 0,
        muteAudio = false,
        losslessCopy = false,
        speed = 1,
        rotation = 'none',
        aspectRatio = 'original',
        canvasFit = 'pad',
        audioBoostDb = 0,
        loudnorm = false,
        exportAsGif = false,
        gifFps = 15,
      } = options;

      if (start > 0) {
        args.push('-ss', start.toString());
      }
      if (end > start) {
        args.push('-to', end.toString());
      }

      args.push('-i', inputFile);

      if (muteAudio) {
        args.push('-an');
      }

      const boostVal = parseFloat(audioBoostDb) || 0;
      const hasVideoEdits =
        speed !== 1 ||
        rotation !== 'none' ||
        aspectRatio !== 'original' ||
        canvasFit === 'stretch' ||
        exportAsGif;

      const hasAudioEdits =
        muteAudio ||
        boostVal > 0 ||
        loudnorm;

      // Instant lossless stream copy only when genuinely no audio or video modifications are requested
      if (losslessCopy && !hasVideoEdits && !hasAudioEdits) {
        args.push('-c', 'copy', outputFile);
        return args;
      }

      if (exportAsGif) {
        args.push('-filter_complex', `[0:v] fps=${gifFps},scale=480:-1:flags=lanczos,split [a][b];[a] palettegen [p];[b][p] paletteuse`);
        args.push(outputFile);
        return args;
      }

      const vFilters = [];
      if (speed !== 1) {
        vFilters.push(`setpts=${1 / speed}*PTS`);
      }

      if (rotation === '90cw') vFilters.push('transpose=1');
      else if (rotation === '90ccw') vFilters.push('transpose=2');
      else if (rotation === '180') vFilters.push('transpose=2,transpose=2');
      else if (rotation === 'hflip') vFilters.push('hflip');
      else if (rotation === 'vflip') vFilters.push('vflip');

      if (aspectRatio !== 'original') {
        const aspectMap = {
          '16:9': { w: 1920, h: 1080, dar: '16/9' },
          '9:16': { w: 1080, h: 1920, dar: '9/16' },
          '1:1': { w: 1080, h: 1080, dar: '1/1' },
          '4:3': { w: 1440, h: 1080, dar: '4/3' },
        };
        const dim = aspectMap[aspectRatio] || { w: 1920, h: 1080, dar: '16/9' };
        if (canvasFit === 'pad') {
          vFilters.push(`scale=${dim.w}:${dim.h}:force_original_aspect_ratio=decrease,pad=${dim.w}:${dim.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1,setdar=${dim.dar}`);
        } else if (canvasFit === 'crop') {
          vFilters.push(`scale=${dim.w}:${dim.h}:force_original_aspect_ratio=increase,crop=${dim.w}:${dim.h},setsar=1:1,setdar=${dim.dar}`);
        } else {
          // Genuine Full Stretch: set pixel SAR to 1:1 and display aspect ratio to target
          vFilters.push(`scale=${dim.w}:${dim.h},setsar=1:1,setdar=${dim.dar}`);
        }
      }

      if (vFilters.length > 0) {
        args.push('-vf', vFilters.join(','));
      }

      const hwInfo = this.getPreferredVideoEncoder('libx264', isRetrySoftware);
      if (hwInfo.isHardware) {
        if (hwInfo.type === 'nvenc') {
          args.push('-c:v', 'h264_nvenc', '-rc:v', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p');
        } else if (hwInfo.type === 'qsv') {
          args.push('-c:v', 'h264_qsv', '-global_quality', '19', '-pix_fmt', 'nv12');
        } else if (hwInfo.type === 'amf') {
          args.push('-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-pix_fmt', 'yuv420p');
        }
      } else {
        args.push('-c:v', 'libx264', '-crf', '19', '-preset', 'fast', '-pix_fmt', 'yuv420p');
      }

      if (!muteAudio) {
        const aFilters = [];
        if (speed !== 1) aFilters.push(`atempo=${speed}`);
        if (boostVal > 0) {
          aFilters.push(`volume=${boostVal}dB`);
        }
        if (loudnorm) {
          aFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        }

        if (aFilters.length > 0) {
          args.push('-af', aFilters.join(','));
        }
        args.push('-c:a', 'aac', '-b:a', '192k');
      }

      if (options.stripMetadata) {
        args.push('-map_metadata', '-1');
      } else {
        args.push('-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it');
      }

      args.push(outputFile);
      return args;
    }

    // Input file for compression / conversion
    args.push('-i', inputFile);

    // 2. COMPRESSOR MODE
    if (mode === 'compress') {
      const {
        type = 'target_size',
        targetSizeMB = 25,
        crf = 24,
        preset = 'medium',
        muteAudio = false,
      } = options;

      if (type === 'target_size' || type === 'discord') {
        const dur = duration > 0 ? duration : 60;
        const totalTargetBits = targetSizeMB * 8 * 1024 * 1024 * 0.96;
        const audioBitrateK = muteAudio ? 0 : 96;
        const audioBits = audioBitrateK * 1000 * dur;
        const remainingBitsForVideo = Math.max(totalTargetBits - audioBits, totalTargetBits * 0.5);
        const videoBitrateK = Math.max(50, Math.floor((remainingBitsForVideo / dur) / 1000));

        const hwInfo = this.getPreferredVideoEncoder('libx264', isRetrySoftware);
        if (hwInfo.isHardware) {
          if (hwInfo.type === 'nvenc') {
            args.push('-c:v', 'h264_nvenc', '-b:v', `${videoBitrateK}k`, '-maxrate', `${Math.round(videoBitrateK * 1.35)}k`, '-bufsize', `${Math.round(videoBitrateK * 2)}k`, '-pix_fmt', 'yuv420p');
          } else if (hwInfo.type === 'qsv') {
            args.push('-c:v', 'h264_qsv', '-b:v', `${videoBitrateK}k`, '-maxrate', `${Math.round(videoBitrateK * 1.35)}k`, '-bufsize', `${Math.round(videoBitrateK * 2)}k`);
          } else if (hwInfo.type === 'amf') {
            args.push('-c:v', 'h264_amf', '-b:v', `${videoBitrateK}k`, '-maxrate', `${Math.round(videoBitrateK * 1.35)}k`, '-bufsize', `${Math.round(videoBitrateK * 2)}k`, '-pix_fmt', 'yuv420p');
          }
        } else {
          args.push('-c:v', 'libx264');
          args.push('-b:v', `${videoBitrateK}k`);
          args.push('-maxrate', `${Math.round(videoBitrateK * 1.35)}k`);
          args.push('-bufsize', `${Math.round(videoBitrateK * 2)}k`);
          args.push('-preset', preset);
          args.push('-pix_fmt', 'yuv420p');
        }

        const boostVal = parseFloat(options.audioBoostDb) || 0;
        if (muteAudio) {
          args.push('-an');
        } else {
          if (boostVal > 0) {
            args.push('-af', `volume=${boostVal}dB`);
          }
          args.push('-c:a', 'aac', '-b:a', `${audioBitrateK}k`);
        }
      } else if (type === 'tiktok') {
        args.push(
          '-c:v', 'libx264',
          '-profile:v', 'main',
          '-refs', '4',
          '-b:v', '20M',
          '-maxrate', '40M',
          '-bufsize', '40M',
          '-fps_mode', 'cfr',
          '-pix_fmt', 'yuv420p',
          '-preset', preset
        );

        const boostVal = parseFloat(options.audioBoostDb) || 0;
        if (muteAudio) {
          args.push('-an');
        } else {
          if (boostVal > 0) {
            args.push('-af', `volume=${boostVal}dB`);
          }
          args.push('-c:a', 'aac', '-b:a', '192k');
        }
      } else {
        const hwInfo = this.getPreferredVideoEncoder('libx264', isRetrySoftware);
        if (hwInfo.isHardware) {
          if (hwInfo.type === 'nvenc') {
            args.push('-c:v', 'h264_nvenc', '-rc:v', 'vbr', '-cq', crf.toString(), '-b:v', '0', '-pix_fmt', 'yuv420p');
          } else if (hwInfo.type === 'qsv') {
            args.push('-c:v', 'h264_qsv', '-global_quality', crf.toString(), '-pix_fmt', 'nv12');
          } else if (hwInfo.type === 'amf') {
            args.push('-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', crf.toString(), '-qp_p', crf.toString(), '-pix_fmt', 'yuv420p');
          }
        } else {
          args.push('-c:v', 'libx264');
          args.push('-crf', crf.toString());
          args.push('-preset', preset);
          args.push('-pix_fmt', 'yuv420p');
        }

        const boostVal = parseFloat(options.audioBoostDb) || 0;
        if (muteAudio) {
          args.push('-an');
        } else {
          if (boostVal > 0) {
            args.push('-af', `volume=${boostVal}dB`);
          }
          args.push('-c:a', 'aac', '-b:a', '160k');
        }
      }

      if (options.stripMetadata) {
        args.push('-map_metadata', '-1');
      } else {
        args.push('-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it');
      }

      args.push(outputFile);
      return args;
    }

    // 3. CONVERTER MODE
    if (mode === 'convert') {
      const {
        format = 'mp4',
        videoCodec = 'libx264',
        audioCodec = 'aac',
        resolution = 'original',
        fps = 'original',
        crf = 22,
        videoBitrate = null,
        audioBitrate = '192k',
        audioOnly = false,
        muteAudio = false,
        stripMetadata = false,
        canvasFit = 'pad',
        audioBoostDb = 0,
      } = options;

      const boostVal = parseFloat(audioBoostDb) || 0;

      if (audioOnly) {
        args.push('-vn');
        if (boostVal > 0 && audioCodec !== 'copy') {
          args.push('-af', `volume=${boostVal}dB`);
        }
        if (audioCodec === 'copy') {
          args.push('-c:a', 'copy');
        } else {
          args.push('-c:a', audioCodec);
          if (audioBitrate) args.push('-b:a', audioBitrate);
        }
      } else {
        if (format === 'gif') {
          const fpsVal = fps === 'original' ? 15 : fps;
          args.push('-filter_complex', `[0:v] fps=${fpsVal},scale=480:-1:flags=lanczos,split [a][b];[a] palettegen [p];[b][p] paletteuse`);
        } else {
          const hwInfo = this.getPreferredVideoEncoder(videoCodec, isRetrySoftware);
          if (videoBitrate) {
            if (hwInfo.isHardware) {
              args.push('-c:v', hwInfo.encoder, '-b:v', videoBitrate, '-pix_fmt', 'yuv420p');
            } else {
              args.push('-c:v', videoCodec, '-b:v', videoBitrate);
            }
          } else if (videoCodec.includes('x264') || videoCodec.includes('x265')) {
            if (hwInfo.isHardware) {
              if (hwInfo.type === 'nvenc') {
                args.push('-c:v', hwInfo.encoder, '-rc:v', 'vbr', '-cq', crf.toString(), '-b:v', '0', '-pix_fmt', 'yuv420p');
              } else if (hwInfo.type === 'qsv') {
                args.push('-c:v', hwInfo.encoder, '-global_quality', crf.toString(), '-pix_fmt', 'nv12');
              } else if (hwInfo.type === 'amf') {
                args.push('-c:v', hwInfo.encoder, '-rc', 'cqp', '-qp_i', crf.toString(), '-qp_p', crf.toString(), '-pix_fmt', 'yuv420p');
              }
            } else {
              args.push('-c:v', videoCodec, '-crf', crf.toString(), '-preset', 'medium', '-pix_fmt', 'yuv420p');
            }
          } else {
            args.push('-c:v', videoCodec);
          }

          const videoFilters = [];
          if (resolution !== 'original') {
            const resMap = {
              '4k': { w: 3840, h: 2160, dar: '16/9' },
              '1440p': { w: 2560, h: 1440, dar: '16/9' },
              '1080p': { w: 1920, h: 1080, dar: '16/9' },
              '720p': { w: 1280, h: 720, dar: '16/9' },
              '480p': { w: 854, h: 480, dar: '16/9' },
              '360p': { w: 640, h: 360, dar: '16/9' },
            };
            const targetRes = resMap[resolution];
            if (targetRes) {
              if (canvasFit === 'stretch') {
                videoFilters.push(`scale=${targetRes.w}:${targetRes.h},setsar=1:1,setdar=${targetRes.dar}`);
              } else if (canvasFit === 'crop') {
                videoFilters.push(`scale=${targetRes.w}:${targetRes.h}:force_original_aspect_ratio=increase,crop=${targetRes.w}:${targetRes.h},setsar=1:1,setdar=${targetRes.dar}`);
              } else {
                videoFilters.push(`scale=${targetRes.w}:${targetRes.h}:force_original_aspect_ratio=decrease,pad=${targetRes.w}:${targetRes.h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1:1,setdar=${targetRes.dar}`);
              }
            }
          }

          if (fps !== 'original') {
            videoFilters.push(`fps=${fps}`);
          }

          if (videoFilters.length > 0) {
            args.push('-vf', videoFilters.join(','));
          }

          if (muteAudio) {
            args.push('-an');
          } else {
            if (boostVal > 0 && audioCodec !== 'copy') {
              args.push('-af', `volume=${boostVal}dB`);
            }
            args.push('-c:a', audioCodec);
            if (audioBitrate && audioCodec !== 'copy') {
              args.push('-b:a', audioBitrate);
            }
          }
        }
      }

      if (stripMetadata) {
        args.push('-map_metadata', '-1');
      } else {
        args.push('-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it');
      }

      args.push(outputFile);
      return args;
    }

    if (!options.stripMetadata) {
      args.push('-metadata', 'comment=Encoded by cut.itzcrih.it', '-metadata', 'description=Encoded by cut.itzcrih.it');
    }
    args.push('-c', 'copy', outputFile);
    return args;
  }

  formatSeconds(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
}

module.exports = Transcoder;
