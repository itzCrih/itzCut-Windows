const STORAGE_KEY = 'itzcut_settings';

export const DEFAULT_SETTINGS = {
  outputDir: '', // empty: Videos\itzCut
  fileSuffix: '_itzCut',
  maxConcurrentJobs: 1,
  encoder: 'auto', // 'auto' (GPU when available) | 'cpu'
  priority: 'normal', // 'normal' | 'below' | 'low'
  hwDecode: false,
  keepAwake: true,
  notifyOnFinish: true,
  completionSound: true,
  openFolderWhenDone: false,
  autoSwitchToQueue: true,
  animations: true,
  accent: 'gold',
};

export const ACCENTS = [
  { id: 'gold', label: 'Gold', color: '#e6b422' },
  { id: 'emerald', label: 'Emerald', color: '#2fbf71' },
  { id: 'sky', label: 'Sky', color: '#3ea6ff' },
  { id: 'violet', label: 'Violet', color: '#9d7bff' },
  { id: 'rose', label: 'Rose', color: '#ff5d8f' },
];

const VALID = {
  maxConcurrentJobs: [1, 2, 3, 4],
  encoder: ['auto', 'cpu'],
  priority: ['normal', 'below', 'low'],
  accent: ACCENTS.map((a) => a.id),
};

function sanitize(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (VALID[key]) {
      if (VALID[key].includes(value)) settings[key] = value;
    } else if (typeof value === typeof DEFAULT_SETTINGS[key]) {
      settings[key] = value;
    }
  }
  settings.fileSuffix = cleanSuffix(settings.fileSuffix);
  return settings;
}

/** Characters Windows refuses in file names are dropped. */
export function cleanSuffix(value) {
  return String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').slice(0, 40);
}

export function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (stored) return sanitize(stored);
    // Older versions stored only the animations switch.
    const legacyAnimations = localStorage.getItem('itzcut_animations');
    return sanitize({ animations: legacyAnimations !== 'false' });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or disabled: settings still apply for this session.
  }
}

/** Output path for a source file: destination folder + base name + suffix + timestamp. */
export function buildOutputPath(dir, sourceName, suffix, ext) {
  const base = sourceName.lastIndexOf('.') > 0 ? sourceName.slice(0, sourceName.lastIndexOf('.')) : sourceName;
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const separator = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\';
  return `${dir}${separator}${base}${suffix || ''}_${stamp}.${ext}`;
}
