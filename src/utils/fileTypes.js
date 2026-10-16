/**
 * Supported File Formats and Validation Utilities for itzCut Desktop
 */

// Supported Video Formats (Containers and Codecs)
export const SUPPORTED_VIDEO_EXTS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'flv',
  'wmv',
  'ts',
  'm2ts',
  'mts',
  '3gp',
  'mpeg',
  'mpg',
  'vob',
  'ogv',
  'gif',
];

// Supported Audio Formats
export const SUPPORTED_AUDIO_EXTS = [
  'mp3',
  'wav',
  'aac',
  'flac',
  'ogg',
  'm4a',
  'wma',
  'opus',
  'aiff',
  'aif',
  'alac',
  'mka',
  'mid',
  'midi',
];

// All Supported Formats
export const ALL_SUPPORTED_EXTS = [
  ...SUPPORTED_VIDEO_EXTS,
  ...SUPPORTED_AUDIO_EXTS,
];

/**
 * Extract clean lowercase file extension without dot
 */
export function getFileExtension(filePathOrName = '') {
  if (!filePathOrName || typeof filePathOrName !== 'string') return '';
  const cleanName = filePathOrName.split(/[?#]/)[0];
  const lastDot = cleanName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return cleanName.substring(lastDot + 1).toLowerCase().trim();
}

/**
 * Returns true if the file extension is a valid video format
 */
export function isVideoExtension(extOrName) {
  const ext = getFileExtension(extOrName) || (extOrName || '').toLowerCase().trim();
  return SUPPORTED_VIDEO_EXTS.includes(ext);
}

/**
 * Returns true if the file extension is a valid audio format
 */
export function isAudioExtension(extOrName) {
  const ext = getFileExtension(extOrName) || (extOrName || '').toLowerCase().trim();
  return SUPPORTED_AUDIO_EXTS.includes(ext);
}

/**
 * Check if the file is an audio file using both extension and mediaInfo
 */
export function isAudioMedia(file, mediaInfo = null) {
  if (!file) return false;
  const ext = getFileExtension(file.name || file.path || '');
  if (isAudioExtension(ext)) return true;
  if (mediaInfo && mediaInfo.video === null && mediaInfo.audio !== null) return true;
  return false;
}

/**
 * Check if the file is a video file using extension and mediaInfo
 */
export function isVideoMedia(file, mediaInfo = null) {
  if (!file) return false;
  const ext = getFileExtension(file.name || file.path || '');
  if (isVideoExtension(ext)) return true;
  if (mediaInfo && mediaInfo.video !== null) return true;
  return false;
}

/**
 * Returns true if the file is supported (either video or audio)
 */
export function isSupportedMedia(filePathOrName) {
  const ext = getFileExtension(filePathOrName);
  return ALL_SUPPORTED_EXTS.includes(ext);
}

/**
 * Validates a file and returns an object with { valid, error, category, ext }
 */
export function validateMediaFile(file) {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }
  const name = file.name || file.path || '';
  const ext = getFileExtension(name);

  if (!ext) {
    return {
      valid: false,
      error: 'File has no extension. Please select a valid video or audio file.',
      ext: '',
      category: 'unknown',
    };
  }

  if (isAudioExtension(ext)) {
    return {
      valid: true,
      category: 'audio',
      ext,
    };
  }

  if (isVideoExtension(ext)) {
    return {
      valid: true,
      category: 'video',
      ext,
    };
  }

  return {
    valid: false,
    error: `Unsupported format (.${ext.toUpperCase()}). itzCut only accepts video and audio files (e.g. MP4, MOV, MKV, MP3, WAV, FLAC).`,
    ext,
    category: 'unsupported',
  };
}
