<div align="center">

# itzCut Desktop (Windows)

**LIGHTWEIGHT HIGH-PERFORMANCE MULTIMEDIA WORKSTATION**  
**x4 TIMES FASTER THAN HANDBRAKE**

The ultra-fast, 100% local Windows suite for video and audio conversion, compression, lossless trimming, and studio editing.

[![Platform](https://img.shields.io/badge/Platform-Windows_10_%7C_11_(x64)-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/itzCrih/itzCut-Windows/releases/latest)
[![Version](https://img.shields.io/badge/Version-v2.4.1-e6b422?style=for-the-badge)](https://github.com/itzCrih/itzCut-Windows/releases/latest)
[![Engine](https://img.shields.io/badge/FFmpeg-v7.1_Native-black?style=for-the-badge)](https://ffmpeg.org)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge)](LICENSE)

<br />

### Download itzCut Desktop

[![Download Setup](https://img.shields.io/badge/Download_Installer-itzCut_Desktop_Setup_(v2.4.1)-e6b422?style=for-the-badge&logo=windows&logoColor=black)](https://github.com/itzCrih/itzCut-Windows/releases/download/v2.4.1/itzCut-Desktop-Setup-2.4.1.exe)  
[![Download Portable](https://img.shields.io/badge/Download_Portable-itzCut_Desktop_Portable_(v2.4.1)-ffffff?style=for-the-badge&logo=windows&logoColor=black)](https://github.com/itzCrih/itzCut-Windows/releases/download/v2.4.1/itzCut-Desktop-2.4.1-Portable.exe)

| Package | Format | Architecture | Direct Link |
| :--- | :--- | :--- | :--- |
| **Windows Installer** | NSIS Setup `.exe` | Windows 10 / 11 (x64) | [itzCut-Desktop-Setup-2.4.1.exe](https://github.com/itzCrih/itzCut-Windows/releases/download/v2.4.1/itzCut-Desktop-Setup-2.4.1.exe) |
| **Standalone Portable** | Portable `.exe` | Windows 10 / 11 (x64) | [itzCut-Desktop-2.4.1-Portable.exe](https://github.com/itzCrih/itzCut-Windows/releases/download/v2.4.1/itzCut-Desktop-2.4.1-Portable.exe) |

*Requires zero installation privileges for the portable build. Built-in Auto-Updater checks for future releases seamlessly on startup.*

</div>

---

## Why itzCut Desktop?

- **x4 Times Faster Than Handbrake:** Optimized encoder pipelines prioritize hardware-accelerated GPU engines (`NVENC`, `QSV`, `AMF`) and minimal-overhead stream operations to deliver maximum processing speed.
- **Lightweight Architecture:** Clean memory footprint, instantaneous startup, and zero background telemetry or bloatware.
- **100% Local Processing & Privacy:** All encoding and trimming runs strictly offline on your machine. Zero cloud uploads, zero privacy compromises, and zero file size restrictions.
- **Zero Configuration Required:** Automatically probes your system, identifies dedicated GPUs and CPUs, verifies hardware capabilities, and downloads static FFmpeg essentials automatically if missing.

---

## Core Capabilities

### 1. Target Size & Social Media Compressor
- **Discord Optimizations:** Instant target bit calculation for **8 MB** (Discord Free limit), **25 MB** (Nitro Basic), and **50 MB** (Nitro Boost).
- **TikTok Profile (2-Pass VBR CFR):** Produces native constant frame-rate (CFR) MP4 streams with 20 Mbps target and 40 Mbps max ceiling, optimized for vertical feeds without re-compression degradation.
- **CRF Quality Engine:** Granular Constant Rate Factor slider with instant quality presets for visually lossless results.

### 2. High-Performance Format Converter
- **Video Encoders:** MP4 (H.264 / NVENC / QSV / AMF / x264), MP4 (H.265 / HEVC), WebM (VP9), MKV, MOV (ProRes / PCM compatibility with instant proxy streaming), and Animated GIF.
- **Dedicated Audio Converter:** Automatic mode switch when audio files are loaded:
  - MP3 (High-rate VBR)
  - WAV (Uncompressed 48 kHz PCM 16-bit)
  - FLAC (Lossless compression)
  - AAC (Advanced Audio Coding)
  - OGG Vorbis
  - Opus (Low-latency voice & music)
- **Resolution & Framerate Control:** Native Passthrough, 4K UHD, 1440p, 1080p, 720p, 480p, or Custom Resolution with Pad, Crop, or Stretch. Framerate presets for 20, 23.976, 24, 25, 29.97, 30, 59.94, and 60 FPS, plus custom numeric input up to 300 FPS and Constant (CFR) vs Variable (VFR) cadence modes.
- **Turbo CRF & FastStart:** Turbo analysis pass (`-fastfirstpass 1`) and Web/Discord FastStart (`-movflags +faststart`) for instant remote streaming.
- **Privacy Stripper:** Optional removal of EXIF tags, GPS metadata, and container tracking details.

### 3. Trimmer & Studio Editing Suite
- **Interactive Scrubber:** Real-time playhead seek needle and draggable In/Out point handles directly on the timeline track.
- **Dedicated Audio Waveform Visualizer:** Real-time interactive audio oscilloscope and spectrum analyzer for pure audio formats (.mp3, .wav, .flac, .aac, .ogg, .m4a).
- **Instant Stream Copy:** True 0-second lossless cut (`-c copy`) whenever re-encoding filters are not requested.
- **Canvas & Aspect Ratio Transforms:** Live preview switching between 9:16 (TikTok/Reels/Shorts), 1:1 (Square), 16:9, and 4:3 with Stretch, Crop, or Letterbox (Pad) options.
- **Realtime Rotation & Flip:** 90° clockwise, 90° counter-clockwise, 180°, and horizontal/vertical flips.
- **Audio Gain Booster:** Amplify audio volume up to +20 dB applied both in the live player and in the final exported file.
- **Precision Keyboard Controls:** Frame-by-frame stepping with arrow keys, quick 5-second jump shortcuts, and playback toggle via Space or K.

### 4. Realtime Queue & Hardware Diagnostics
- **Live Visual Queue:** Multi-job management with percentage completion, encoding FPS, speed multiplier (e.g. 25.4x), elapsed duration, and estimated time remaining.
- **Selectable Logs & One-Click Copy:** View raw FFmpeg console output with selectable text and a dedicated "Copy Logs" button for quick troubleshooting.
- **Clean Cancellation:** Cancelling an active encode immediately halts child processes, removes the job entry, and deletes temporary scratch files from disk.
- **Render Completion Sound:** Synthesized Web Audio chime to notify you the instant an export finishes.
- **Instant Cached Hardware Detection:** Probes GPU encoders and caches specs for <1 second subsequent launches.

---

## File Support Matrix

| Category | Supported Extensions | Processing Engine |
| :--- | :--- | :--- |
| **Video Files** | `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.m4v`, `.flv`, `.wmv` | Native GPU HWAccel (NVENC, QSV, AMF) or CPU multi-thread |
| **Audio Files** | `.mp3`, `.wav`, `.flac`, `.aac`, `.ogg`, `.m4a`, `.wma` | Dedicated Audio Studio with waveform visualization |
| **Non-Media Files** | `.png`, `.jpg`, `.pdf`, `.exe`, etc. | Automatically blocked with detailed error alert |

---

## License & Terms of Use

itzCut Desktop is proprietary software developed by itzcrih.

- **Personal Use:** Free for personal, non-commercial use via official binaries.
- **No Redistribution:** You may not re-upload, mirror, host, or distribute itzCut Desktop binaries or source code on third-party sites or repositories.
- **No Skidding / Rebranding:** You may not copy, extract, adapt, re-skin, rename, or claim authorship over any part of this software, its UI, or its source code.
- Full legal details are specified in the [LICENSE](LICENSE) document.

---

## Links & Community

- **Official Web Platform:** [cut.itzcrih.it](https://cut.itzcrih.it)
- **Discord Community:** [community.itzcrih.it](https://community.itzcrih.it)
- **Author:** [itzcrih.it](https://itzcrih.it)
- **Copyright:** (C) 2026 itzcrih. All Rights Reserved.
