export const COMPRESSOR_PRESETS = [
  {
    id: 'crf-balanced',
    title: 'Balanced Quality',
    tag: 'CRF 23',
    type: 'crf',
    crf: 23,
    preset: 'medium',
    desc: 'Sweet spot between compact file footprint and natural video clarity.',
  },
  {
    id: 'crf-high',
    title: 'Max Compression',
    tag: 'CRF 28',
    type: 'crf',
    crf: 28,
    preset: 'faster',
    desc: 'Aggressive file reduction (up to -80%), great for web sharing and space savings.',
  },
  {
    id: 'tiktok',
    title: 'TikTok',
    tag: 'VBR',
    type: 'tiktok',
    desc: 'Two-pass 20 Mbps VBR (40 Mbps peak), constant frame rate, Main profile, native resolution.',
  },
  {
    id: 'size-8mb',
    title: 'Small Upload',
    tag: '8 MB',
    type: 'target_size',
    targetSizeMB: 8,
    desc: 'Strict size limit with the bitrate calculated to never overshoot.',
  },
  {
    id: 'size-25mb',
    title: 'Standard Upload',
    tag: '25 MB',
    type: 'target_size',
    targetSizeMB: 25,
    desc: 'Crisp 1080p clips that still fit common upload limits.',
  },
  {
    id: 'size-50mb',
    title: 'Large Upload',
    tag: '50 MB',
    type: 'target_size',
    targetSizeMB: 50,
    desc: 'Generous allocation for longer videos with pristine detail.',
  },
];

export const CONVERTER_VIDEO_FORMATS = [
  { ext: 'mp4', label: 'MP4', tag: 'H.264', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Universal playback compatibility on any device' },
  { ext: 'mp4-hevc', label: 'MP4', tag: 'HEVC', defaultCodec: 'libx265', audioCodec: 'aac', desc: 'Half the size of H.264 at identical visual quality' },
  { ext: 'webm', label: 'WebM', tag: 'VP9', defaultCodec: 'libvpx-vp9', audioCodec: 'libopus', desc: 'Optimized for modern web, Chrome and Discord' },
  { ext: 'mkv', label: 'Matroska', tag: 'MKV', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Flexible container for multiple tracks and subtitles' },
  { ext: 'mov', label: 'QuickTime', tag: 'MOV', defaultCodec: 'libx264', audioCodec: 'aac', desc: 'Ideal for Premiere Pro and DaVinci Resolve' },
  { ext: 'gif', label: 'Animated GIF', tag: 'GIF', defaultCodec: 'gif', audioCodec: 'none', desc: 'High-definition looping GIF with an optimized palette' },
];

export const CONVERTER_AUDIO_FORMATS = [
  { ext: 'mp3', label: 'MP3', tag: '320k', audioCodec: 'libmp3lame', defaultBitrate: '320k', desc: 'Universal audio standard at up to 320 kbps' },
  { ext: 'wav', label: 'WAV', tag: 'PCM', audioCodec: 'pcm_s16le', defaultBitrate: 'uncompressed', desc: 'Uncompressed studio master recording' },
  { ext: 'aac', label: 'AAC', tag: '256k', audioCodec: 'aac', defaultBitrate: '256k', desc: 'Efficient streaming standard for web and mobile' },
  { ext: 'flac', label: 'FLAC', tag: 'Lossless', audioCodec: 'flac', defaultBitrate: 'lossless', desc: 'Bit-perfect compression with zero quality loss' },
  { ext: 'opus', label: 'Opus', tag: 'OGG', audioCodec: 'libopus', defaultBitrate: '128k', desc: 'Remarkable clarity at low bitrates' },
  { ext: 'ogg', label: 'Vorbis', tag: 'OGG', audioCodec: 'libvorbis', defaultBitrate: '192k', desc: 'Open lossy format with rich dynamics' },
  { ext: 'm4a', label: 'M4A', tag: 'AAC', audioCodec: 'aac', defaultBitrate: '256k', desc: 'Native Apple container for iOS and macOS' },
];

/** x264 speed presets offered in the UI, fastest first. */
export const SPEED_PRESETS = ['ultrafast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'];

/** "slower" roughly doubles encode time again; only offered on machines that can afford it. */
export function isPowerfulMachine(systemInfo) {
  if (!systemInfo) return false;
  return (systemInfo.cpuCores || 0) >= 12 && (systemInfo.ramGb || 0) >= 16;
}

export const RESOLUTION_OPTIONS = [
  { value: '4k', label: '4K Ultra HD', hint: '3840×2160' },
  { value: '1440p', label: '2K QHD', hint: '2560×1440' },
  { value: '1080p', label: 'Full HD', hint: '1920×1080' },
  { value: '720p', label: 'HD', hint: '1280×720' },
  { value: '480p', label: 'SD', hint: '854×480' },
  { value: 'custom', label: 'Custom…', hint: 'W×H' },
];

export const FPS_OPTIONS = [
  { value: '60', label: '60', hint: 'fps' },
  { value: '59.94', label: '59.94', hint: 'fps' },
  { value: '30', label: '30', hint: 'fps' },
  { value: '29.97', label: '29.97', hint: 'fps' },
  { value: '25', label: '25', hint: 'fps' },
  { value: '24', label: '24', hint: 'fps' },
  { value: '23.976', label: '23.976', hint: 'fps' },
  { value: 'custom', label: 'Custom…', hint: '1–300' },
];

export const AUDIO_BITRATES = [
  { value: '320k', label: '320 kbps', hint: 'Studio' },
  { value: '256k', label: '256 kbps', hint: 'Very high' },
  { value: '192k', label: '192 kbps', hint: 'Standard' },
  { value: '128k', label: '128 kbps', hint: 'Compact' },
  { value: '64k', label: '64 kbps', hint: 'Voice' },
];
