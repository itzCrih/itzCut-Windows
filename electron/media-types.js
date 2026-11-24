'use strict';

const path = require('path');

/** Keep in sync with src/utils/fileTypes.js. */
const VIDEO_EXTS = ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'ts', 'm2ts', 'mts', '3gp', 'mpeg', 'mpg', 'vob', 'ogv', 'gif'];
const AUDIO_EXTS = ['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'aif', 'alac', 'mka', 'mid', 'midi'];
const MEDIA_EXTS = new Set([...VIDEO_EXTS, ...AUDIO_EXTS]);

/** Containers the app writes. */
const OUTPUT_EXTS = new Set(['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'flv', 'wmv', 'ts', 'm2ts', 'mts', '3gp', 'mpeg', 'mpg', 'ogv', 'gif', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'opus', 'aiff', 'aif', 'mka']);

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/mp4',
  '.mov': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.ts': 'video/mp2t',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.mka': 'audio/x-matroska',
};

function bareExtension(fileOrExt) {
  const ext = fileOrExt.startsWith('.') || !fileOrExt.includes('.') ? fileOrExt : path.extname(fileOrExt);
  return ext.replace(/^\./, '').toLowerCase();
}

function isMediaFile(filePath) {
  return typeof filePath === 'string' && MEDIA_EXTS.has(bareExtension(path.extname(filePath)));
}

function isOutputExtension(ext) {
  return typeof ext === 'string' && OUTPUT_EXTS.has(bareExtension(ext));
}

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

module.exports = { VIDEO_EXTS, AUDIO_EXTS, isMediaFile, isOutputExtension, mimeTypeFor };
