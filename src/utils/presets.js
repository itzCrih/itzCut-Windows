export const COMPRESSOR_PRESETS = [
  {
    id: 'crf-balanced',
    title: 'Balanced Quality (CRF 23)',
    tag: 'CRF 23',
    type: 'crf',
    crf: 23,
    preset: 'medium',
    desc: 'Sweet spot between compact file footprint and natural video clarity.',
  },
  {
    id: 'crf-high',
    title: 'Max Compression (CRF 28)',
    tag: 'CRF 28',
    type: 'crf',
    crf: 28,
    preset: 'faster',
    desc: 'Aggressive file reduction (up to -80%), great for web sharing and space savings.',
  },
  {
    id: 'tiktok',
    title: 'TikTok (2-Pass VBR / 20 Mbps CFR)',
    tag: 'TikTok VBR',
    type: 'tiktok',
    desc: 'Native resolution, constant frame rate (CFR), Main profile, 4 ref frames, 2-Pass VBR (20 Mbps target, 40 Mbps peak).',
  },
  {
    id: 'discord-25mb',
    title: 'Target Size (25 MB)',
    tag: '25 MB',
    type: 'target_size',
    targetSizeMB: 25,
    desc: 'Calculated target size for 1080p clips with high visual crispness.',
  },
  {
    id: 'discord-8mb',
    title: 'Target Size (8 MB)',
    tag: '8 MB',
    type: 'target_size',
    targetSizeMB: 8,
    desc: 'Strict 8 MB target limit with bitrate mathematically calculated to avoid blowout.',
  },
  {
    id: 'discord-50mb',
    title: 'Target Size (50 MB)',
    tag: '50 MB',
    type: 'target_size',
    targetSizeMB: 50,
    desc: 'Generous allocation for longer videos with pristine detail.',
  },
];

export const CONVERTER_VIDEO_FORMATS = [
  { ext: 'mp4', label: 'MP4 (H.264)', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Universal playback compatibility on any device' },
  { ext: 'mp4-hevc', label: 'MP4 (H.265 / HEVC)', defaultCodec: 'libx265', audioCodec: 'aac', desc: '50% higher compression efficiency at identical visual quality' },
  { ext: 'webm', label: 'WebM (VP9)', defaultCodec: 'libvpx-vp9', audioCodec: 'libopus', desc: 'Optimized for modern web, Chrome and Discord' },
  { ext: 'mkv', label: 'Matroska (MKV)', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Flexible container supporting multiple tracks and subtitles' },
  { ext: 'mov', label: 'QuickTime (MOV)', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Ideal for editing workflow in Premiere Pro & DaVinci Resolve' },
  { ext: 'gif', label: 'Animated GIF', defaultCodec: 'gif', audioCodec: 'none', desc: 'High-definition looping GIF powered by two-pass palettegen' },
];

export const CONVERTER_AUDIO_FORMATS = [
  { ext: 'mp3', label: 'MP3 (MPEG-3)', audioCodec: 'libmp3lame', defaultBitrate: '320k', desc: 'Universal audio standard with maximum 320 kbps fidelity' },
  { ext: 'wav', label: 'WAV (Studio PCM)', audioCodec: 'pcm_s16le', defaultBitrate: 'uncompressed', desc: 'Uncompressed studio master PCM recording' },
  { ext: 'aac', label: 'AAC (Apple Audio)', audioCodec: 'aac', defaultBitrate: '256k', desc: 'High-efficiency streaming standard for modern web and mobile' },
  { ext: 'flac', label: 'FLAC Lossless', audioCodec: 'flac', defaultBitrate: 'lossless', desc: 'Bit-perfect lossless compression with zero acoustic compromise' },
  { ext: 'opus', label: 'OGG OPUS', audioCodec: 'libopus', defaultBitrate: '128k', desc: 'State-of-the-art codec with incredible clarity at low bitrates' },
  { ext: 'ogg', label: 'OGG Vorbis', audioCodec: 'libvorbis', defaultBitrate: '192k', desc: 'Open-source lossy audio format with rich sound dynamics' },
  { ext: 'm4a', label: 'M4A (AAC / ALAC)', audioCodec: 'aac', defaultBitrate: '256k', desc: 'Native Apple container for iOS and macOS music ecosystems' },
];
