import React, { useState } from 'react';
import {
  Volume2,
  Sliders,
  Image as ImageIcon,
  Crop,
  RotateCw,
  Folder,
  Sparkles,
  Music,
} from 'lucide-react';
import DropZone from '../components/DropZone';

export default function StudioToolsTab({
  currentFile,
  mediaInfo,
  onFileSelected,
  onFileCleared,
  defaultOutputDir,
  onAddJob,
  onShowToast,
}) {
  const [selectedTool, setSelectedTool] = useState('boost'); // 'boost', 'loudnorm', 'gif', 'canvas', 'rotate'
  const [boostDb, setBoostDb] = useState(6);
  const [gifFps, setGifFps] = useState(15);
  const [gifWidth, setGifWidth] = useState(480);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [canvasFit, setCanvasFit] = useState('pad'); // 'pad', 'crop', 'stretch'
  const [rotation, setRotation] = useState('90cw');
  const [outputDir, setOutputDir] = useState(defaultOutputDir || '');

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setOutputDir(folder);
  };

  const tools = [
    {
      id: 'boost',
      title: 'Amplificatore Audio (+dB)',
      icon: Volume2,
      desc: 'Aumenta il volume di video o tracce vocali troppo basse senza distorsione.',
    },
    {
      id: 'loudnorm',
      title: 'Normalizzazione EBU R128',
      icon: Sliders,
      desc: 'Uniforma il volume standard broadcast per YouTube, podcast e streaming.',
    },
    {
      id: 'gif',
      title: 'Generatore GIF HD',
      icon: ImageIcon,
      desc: 'Crea GIF animate fluide ad alta fedeltà con algoritmo palettegen a 256 colori.',
    },
    {
      id: 'canvas',
      title: 'Canvas & Aspetto (16:9 / 9:16 / 1:1)',
      icon: Crop,
      desc: 'Adatta video orizzontali a formati verticali TikTok/Reels o quadrati Instagram con barre nere o crop.',
    },
    {
      id: 'rotate',
      title: 'Rotazione & Rifletti',
      icon: RotateCw,
      desc: 'Ruota video ripresi in obliquo (90°, 180°) o crea effetto specchio (flip).',
    },
  ];

  const handleRunTool = () => {
    if (!currentFile) {
      onShowToast('Carica un file multimediale prima di procedere!', 'error');
      return;
    }

    const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) || currentFile.name;
    const targetDir = outputDir || defaultOutputDir;
    let outExt = 'mp4';
    if (selectedTool === 'gif') outExt = 'gif';
    const outputFile = `${targetDir}\\${baseName}_${selectedTool}_${Date.now()}.${outExt}`;

    let toolOptions = { tool: selectedTool };
    let toolTitle = 'Strumento Studio';

    if (selectedTool === 'boost') {
      toolOptions = { tool: 'audio_boost', boostDb };
      toolTitle = `Audio Boost +${boostDb}dB`;
    } else if (selectedTool === 'loudnorm') {
      toolOptions = { tool: 'loudnorm' };
      toolTitle = `Normalizzazione Audio EBU R128`;
    } else if (selectedTool === 'gif') {
      toolOptions = { tool: 'gif', gifFps, gifWidth };
      toolTitle = `Creazione GIF HD (${gifFps} fps, ${gifWidth}px)`;
    } else if (selectedTool === 'canvas') {
      toolOptions = { tool: 'canvas_resize', aspectRatio, canvasFit };
      toolTitle = `Resize Canvas ${aspectRatio} (${canvasFit})`;
    } else if (selectedTool === 'rotate') {
      toolOptions = { tool: 'rotate', rotate: rotation };
      toolTitle = `Rotazione Video (${rotation})`;
    }

    const jobConfig = {
      jobId: `studio_${Date.now()}`,
      inputFile: currentFile.path,
      outputFile,
      mode: 'studio',
      duration: mediaInfo?.duration || 0,
      options: toolOptions,
      title: toolTitle,
      inputName: currentFile.name,
    };

    onAddJob(jobConfig);
    onShowToast(`Elaborazione ${toolTitle} avviata in coda!`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <DropZone
        currentFile={currentFile}
        mediaInfo={mediaInfo}
        onFileSelected={onFileSelected}
        onFileCleared={onFileCleared}
      />

      {currentFile && (
        <div className="grid-2">
          {/* Tool Selector List */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Sparkles size={18} />
                <span>Strumenti Studio itzCut</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tools.map((t) => {
                const Icon = t.icon;
                const isSelected = selectedTool === t.id;
                return (
                  <div
                    key={t.id}
                    className={`preset-card ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedTool(t.id)}
                  >
                    <div className="preset-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon size={16} color={isSelected ? '#e6b422' : 'var(--text-muted)'} />
                        <span className="preset-title">{t.title}</span>
                      </div>
                    </div>
                    <span className="preset-desc">{t.desc}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Config Panel for the Selected Tool */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span>Configura Strumento</span>
              </div>
            </div>

            {selectedTool === 'boost' && (
              <div className="form-group">
                <label className="form-label">
                  <span>Guadagno Volume: +{boostDb} dB</span>
                  <span className="form-label-tag">+{boostDb} dB</span>
                </label>
                <input
                  type="range"
                  className="range-slider"
                  min="1"
                  max="24"
                  value={boostDb}
                  onChange={(e) => setBoostDb(parseInt(e.target.value, 10))}
                />
                <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                  Aumenta il guadagno sonoro. +6dB raddoppia l'ampiezza dell'onda.
                </span>
              </div>
            )}

            {selectedTool === 'loudnorm' && (
              <div style={{ padding: '16px', background: 'rgba(230, 180, 34, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-gold)', marginBottom: '16px' }}>
                <h4 style={{ fontSize: '14px', color: 'var(--gold-primary)', marginBottom: '6px' }}>
                  Standard Broadcast EBU R128 (-16 LUFS)
                </h4>
                <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  Calibra il target loudness con picco massimo True Peak di -1.5 dBTP. Rende l'audio equilibrato senza clip né abbassamenti improvvisi da parte dell'algoritmo di YouTube o Spotify.
                </p>
              </div>
            )}

            {selectedTool === 'gif' && (
              <>
                <div className="form-group">
                  <label className="form-label">Framerate GIF (FPS)</label>
                  <select
                    className="form-select"
                    value={gifFps}
                    onChange={(e) => setGifFps(parseInt(e.target.value, 10))}
                  >
                    <option value="10">10 FPS (Leggero)</option>
                    <option value="15">15 FPS (Consigliato, bilanciato)</option>
                    <option value="24">24 FPS (Cinematografico fluido)</option>
                    <option value="30">30 FPS (Ultra-fluido)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Larghezza Massima GIF</label>
                  <select
                    className="form-select"
                    value={gifWidth}
                    onChange={(e) => setGifWidth(parseInt(e.target.value, 10))}
                  >
                    <option value="320">320px (Piccolo - Discord emote)</option>
                    <option value="480">480px (Standard ottima qualità)</option>
                    <option value="640">640px (Grande HD)</option>
                  </select>
                </div>
              </>
            )}

            {selectedTool === 'canvas' && (
              <>
                <div className="form-group">
                  <label className="form-label">Proporzione Destinazione</label>
                  <select
                    className="form-select"
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                  >
                    <option value="9:16">9:16 Verticale (TikTok / Reels / Shorts)</option>
                    <option value="16:9">16:9 Orizzontale (YouTube / PC)</option>
                    <option value="1:1">1:1 Quadrato (Instagram Feed)</option>
                    <option value="4:3">4:3 Classico Retro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Modalità Adattamento</label>
                  <select
                    className="form-select"
                    value={canvasFit}
                    onChange={(e) => setCanvasFit(e.target.value)}
                  >
                    <option value="pad">Fit con Barre Nere (Nessun ritaglio)</option>
                    <option value="crop">Fill & Crop (Riempi tutto lo schermo)</option>
                    <option value="stretch">Allunga / Deforma</option>
                  </select>
                </div>
              </>
            )}

            {selectedTool === 'rotate' && (
              <div className="form-group">
                <label className="form-label">Angolo di Rotazione / Riflesso</label>
                <select
                  className="form-select"
                  value={rotation}
                  onChange={(e) => setRotation(e.target.value)}
                >
                  <option value="90cw">Ruota 90° Orario</option>
                  <option value="90ccw">Ruota 90° Antiorario</option>
                  <option value="180">Capovolgi 180°</option>
                  <option value="hflip">Rifletti Orizzontalmente (Specchio)</option>
                  <option value="vflip">Rifletti Verticalmente</option>
                </select>
              </div>
            )}

            {/* Destination folder */}
            <div className="form-group">
              <label className="form-label">Cartella di destinazione</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  className="form-input"
                  value={outputDir || defaultOutputDir || ''}
                  readOnly
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" onClick={handlePickOutputDir}>
                  <Folder size={15} />
                  <span>Sfoglia</span>
                </button>
              </div>
            </div>

            <div style={{ marginTop: '20px' }}>
              <button
                className="btn-gold"
                style={{ width: '100%', padding: '12px' }}
                onClick={handleRunTool}
              >
                <Sparkles size={16} />
                <span>Applica ed Elabora</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
