const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function getGitHubToken() {
  const out = cp.execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n',
  }).toString();
  const match = out.match(/password=(.*)/);
  if (!match) throw new Error('Could not find GitHub token from git credentials');
  return match[1].trim();
}

async function publishRelease() {
  const rootDir = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const version = pkg.version;
  const tag = `v${version}`;
  const name = `itzCut Desktop v${version}`;

  const token = getGitHubToken();
  const owner = 'itzCrih';
  const repo = 'itzCut-Windows';

  const body = `## itzCut Desktop v${version}

### Novità e Miglioramenti
- **Controllo e Validazione File Rigorosa:** Rifiuto automatico per file non multimediali (es. PNG, JPG, PDF, EXE) con notifica immediata e filtri selettivi.
- **Supporto Completo .MOV & Proxy Preview:** Compatibilità garantita con Apple ProRes, PCM e formati professionali tramite generazione automatica ultra-veloce di proxy di anteprima senza lag.
- **Trimmer Audio Dedicato con Waveform:** Se viene importato un file audio (.mp3, .wav, .flac, .aac, .ogg, .m4a), l'app attiva un lettore waveform ad onda sonora interattivo in tempo reale con selettori In/Out e Gain Boost.
- **Convertitore Audio Reale:** Esportazione audio fedele con profili dedicati (MP3 VBR High, WAV PCM 48kHz, FLAC lossless, AAC, OGG Vorbis, Opus).
- **Auto-Updater Integrato:** Controllo istantaneo all'avvio con download silenzioso degli aggiornamenti in background.
- **Web Installer Leggero:** File di setup rapido \`itzCut-Setup.exe\` (~200 KB) perfetto per la condivisione su Discord e web.

### Download
- **itzCut-Desktop-Setup-${version}.exe** — Installer NSIS completo per Windows (x64)
- **itzCut-Desktop-${version}-Portable.exe** — Versione portatile standalone
- **itzCut-Setup.exe** — Web Installer ultraleggero (~200 KB)`;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'itzCut-Release-Publisher',
  };

  console.log(`Checking existing releases for ${owner}/${repo}...`);
  const listRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, { credentials: 'omit', headers });
  if (!listRes.ok) {
    throw new Error(`Failed to list releases: ${listRes.status} ${await listRes.text()}`);
  }
  const releases = await listRes.json();
  let release = releases.find((r) => r.tag_name === tag);

  if (release) {
    console.log(`Release ${tag} already exists (id: ${release.id}). Updating metadata...`);
    const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, body, draft: false, prerelease: false }),
    });
    if (!updateRes.ok) {
      throw new Error(`Failed to update release: ${updateRes.status} ${await updateRes.text()}`);
    }
    release = await updateRes.json();
  } else {
    console.log(`Creating release ${tag}...`);
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: 'main',
        name,
        body,
        draft: false,
        prerelease: false,
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Failed to create release: ${createRes.status} ${await createRes.text()}`);
    }
    release = await createRes.json();
    console.log(`Created release id: ${release.id}`);
  }

  const existingAssets = release.assets || [];

  const assetsToUpload = [
    {
      name: `itzCut-Desktop-Setup-${version}.exe`,
      filePath: path.join(rootDir, 'release', `itzCut-Desktop-Setup-${version}.exe`),
    },
    {
      name: `itzCut-Desktop-${version}-Portable.exe`,
      filePath: path.join(rootDir, 'release', `itzCut-Desktop-${version}-Portable.exe`),
    },
    {
      name: 'itzCut-Setup.exe',
      filePath: path.join(rootDir, 'release', 'itzCut-Setup.exe'),
    },
  ];

  for (const asset of assetsToUpload) {
    if (!fs.existsSync(asset.filePath)) {
      console.warn(`File ${asset.filePath} not found, skipping.`);
      continue;
    }

    const stat = fs.statSync(asset.filePath);
    const existing = existingAssets.find((a) => a.name === asset.name);
    if (existing) {
      console.log(`Asset ${asset.name} already exists (id: ${existing.id}). Deleting old asset...`);
      const delRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`, {
        method: 'DELETE',
        headers,
      });
      if (!delRes.ok) {
        console.warn(`Could not delete asset ${asset.name}: ${delRes.status}`);
      } else {
        console.log(`Deleted existing asset ${asset.name}.`);
      }
    }

    console.log(`Uploading ${asset.name} (${(stat.size / 1024 / 1024).toFixed(2)} MB)...`);
    const fileBuffer = fs.readFileSync(asset.filePath);

    const uploadRes = await fetch(`https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stat.size),
        'User-Agent': 'itzCut-Release-Publisher',
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`Failed to upload ${asset.name}: ${uploadRes.status} ${errText}`);
    }

    const uploaded = await uploadRes.json();
    console.log(`Successfully uploaded ${asset.name} (id: ${uploaded.id})!`);
  }

  console.log(`All assets uploaded for release ${tag} successfully!`);
}

publishRelease().catch((err) => {
  console.error('Error publishing release:', err);
  process.exit(1);
});
