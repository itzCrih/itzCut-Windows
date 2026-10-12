# itzCut Desktop (Windows)

> **Professional Windows Desktop Workstation for 100% local video & audio converting, compressing, trimming, and editing.**  
> Native Windows companion to [cut.itzcrih.it](https://cut.itzcrih.it).

---

## Features

- **100% Local Processing:** All encoding runs directly on your local CPU & GPU using native **FFmpeg 7.1**. Zero cloud uploads, zero privacy compromises, and no file size limits.
- **Hardware Acceleration Priority:** Forced GPU encoding (`h264_nvenc` for NVIDIA, `h264_qsv` for Intel, `h264_amf` for AMD) by default across all workflows, with automatic transparent fallback to CPU multi-threaded `libx264`.
- **Sleek Windows Desktop Design:** Dark high-contrast palette (`#07090e`) with glowing gold accents (`#e6b422`), frosted glass blur, interactive animated logo, and custom frameless titlebar with native Windows 11 style minimize/maximize/close buttons.
- **Convert & Compress Tab:**
  - **Target Size Compressor:** Bit budget calculation for **8 MB** (Discord Free), **25 MB** (Nitro Basic), **50 MB** (Nitro Boost), and **TikTok VBR** (2-pass 20-40 Mbps native CFR MP4).
  - **CRF Quality Optimizer:** Visual slider and quick presets for balanced and high quality CRF encoding.
  - **Format Converter:**
    - **Video:** MP4 (H.264), MP4 (H.265 / HEVC), WebM (VP9), MKV, MOV (QuickTime), Animated GIF.
    - **Audio:** MP3 (320 kbps), AAC, WAV (Lossless PCM), FLAC, OPUS.
  - Resolution selector (Original, 4K, 1440p, 1080p, 720p, 480p) & Framerate control (60fps, 30fps, 24fps).
  - Strip EXIF & privacy metadata.
- **Trimmer Tab (with Integrated Studio Tools):**
  - **Interactive Scrubber:** Draggable playhead needle arrow and draggable In/Out cut handles directly on the timeline bar.
  - **Keyboard Shortcuts:** `Space` or `K` to Play/Pause, `←` / `→` arrows to step backward/forward by 1 frame.
  - **Seek Controls:** `-5s` and `+5s` quick jump buttons.
  - **Live Preview for Rotation & Flip:** 90° CW, 90° CCW, 180°, and horizontal/vertical flip rendered live in the player with quick reset.
  - **Live Aspect Ratio / Canvas Preview:** 9:16 (TikTok/Reels/Shorts), 1:1 (Instagram Square), 16:9, or 4:3 with Black Bars (Pad), Crop, or Stretch.
  - **Audio Gain Boost:** Amplify recordings up to +20 dB applied in real-time preview and final export.
  - **Instant Lossless Cut:** 0-second stream copy (`-c copy`) when no re-encoding filters are needed.
- **Realtime Queue Tab:**
  - Live animated striped progress bar.
  - Realtime stats: Percentage %, FPS, Speed multiplier (e.g. `23.6x`), elapsed time, and remaining ETA.
  - Clean job cancellation: immediately terminates FFmpeg, removes the job, and cleans up partial working files on disk without error toasts.
  - Synthesized Web Audio chime upon render completion.
- **Settings & Diagnostics:**
  - Physical testing of GPU encoders to avoid false positives.
  - Accurate CPU model, thread count, RAM, and GPU adapter detection.
  - Optional Desktop diagnostic debug mode.
  - Automated downloader for static FFmpeg binaries if not installed.

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start in Development Mode
```bash
npm start
```
*Launches the Vite dev server and the Electron desktop application concurrently with live reload.*

### 3. Run Automated Tests
```bash
npm test
```
*Runs the end-to-end test suite checking FFmpeg detection, media generation, probing, trimming, rotation, stretch fit, audio gain boost, and TikTok 2-pass profiles.*

### 4. Build Production Binaries
```bash
npm run dist
```
*Generates standalone Portable `.exe` and NSIS Setup installer in the `release/` directory.*

---

## Tech Stack
- **Desktop Runtime:** Electron 34
- **Frontend:** React 18 + Vite 6
- **Styling:** CSS3 (itzCut Dark & Gold theme: `#07090e`, `#e6b422`, Inter, JetBrains Mono)
- **Icons:** Lucide React
- **Multimedia Engine:** Native FFmpeg 7.1 + FFprobe via Node child process stream parsing

---

## Community & Credits
- Web Version: [cut.itzcrih.it](https://cut.itzcrih.it)
- Discord Community: [community.itzcrih.it](https://community.itzcrih.it)
- Author: © 2026 [itzcrih.it](https://itzcrih.it)
