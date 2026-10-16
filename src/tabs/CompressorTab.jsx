import React, { useState } from 'react';
import { Minimize2, Zap, Sliders, Check, Folder, Sparkles } from 'lucide-react';
import DropZone from '../components/DropZone';
import { COMPRESSOR_PRESETS } from '../utils/presets';
import { formatBytes } from '../utils/formatters';

export default function CompressorTab({
  currentFile,
  mediaInfo,
  onFileSelected,
  onFileCleared,
  defaultOutputDir,
  onAddJob,
  onShowToast,
}) {
  const [compressMode, setCompressMode] = useState('target'); // 'target' (Discord/MB) or 'crf'
  const [selectedPreset, setSelectedPreset] = useState('discord-25mb');
  const [customTargetMB, setCustomTargetMB] = useState(25);
  const [crfValue, setCrfValue] = useState(24);
  const [speedPreset, setSpeedPreset] = useState('medium');
  const [muteAudio, setMuteAudio] = useState(false);
  const [outputDir, setOutputDir] = useState(defaultOutputDir || '');

  const handlePickOutputDir = async () => {
    if (!window.itzCutAPI) return;
    const folder = await window.itzCutAPI.selectFolderDialog();
    if (folder) setOutputDir(folder);
  };

  // Calculate estimated target bitrate and reduction
  const duration = mediaInfo?.duration || 60;
  const originalSizeMB = currentFile ? currentFile.size / (1024 * 1024) : 100;
  const currentTargetMB = compressMode === 'target' ? customTargetMB : (originalSizeMB * 0.4);
  const estimatedSaving = originalSizeMB > 0 ? Math.max(0, Math.round((1 - (currentTargetMB / originalSizeMB)) * 100)) : 50;

  const handlePresetSelect = (preset) => {
    setSelectedPreset(preset.id);
    if (preset.type === 'discord') {
      setCompressMode('target');
      setCustomTargetMB(preset.targetSizeMB);
    } else {
      setCompressMode('crf');
      setCrfValue(preset.crf);
      if (preset.preset) setSpeedPreset(preset.preset);
    }
  };

  const handleStartCompression = () => {
    if (!currentFile) {
      onShowToast('Carica prima un file da comprimere!', 'error');
      return;
    }

    const baseName = currentFile.name.substring(0, currentFile.name.lastIndexOf('.')) || currentFile.name;
    const targetDir = outputDir || defaultOutputDir;
    const outputFile = `${targetDir}\\${baseName}_compressed_${Date.now()}.mp4`;

    const jobConfig = {
      jobId: `comp_${Date.now()}`,
      inputFile: currentFile.path,
      outputFile,
      mode: 'compress',
      duration: mediaInfo?.duration || 0,
      options: {
        type: compressMode === 'target' ? 'target_size' : 'crf',
        targetSizeMB: customTargetMB,
        crf: parseInt(crfValue, 10),
        preset: speedPreset,
        muteAudio,
      },
      title: compressMode === 'target'
        ? `Compressione Target ${customTargetMB}MB`
        : `Compressione CRF ${crfValue}`,
      inputName: currentFile.name,
    };

    onAddJob(jobConfig);
    onShowToast(`Job di compressione avviato in coda!`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <DropZone
        currentFile={currentFile}
        mediaInfo={mediaInfo}
        onFileSelected={onFileSelected}
        onFileCleared={onFileCleared}
        onShowToast={onShowToast}
      />

      {currentFile && (
        <div className="grid-2">
          {/* Preset Selector */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <Minimize2 size={18} />
                <span>Modalità & Preset di Compressione</span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <button
                className={`btn-secondary ${compressMode === 'target' ? 'active' : ''}`}
                onClick={() => setCompressMode('target')}
                style={{ flex: 1 }}
              >
                <Zap size={14} />
                <span>Dimensione Target (Discord / MB)</span>
              </button>
              <button
                className={`btn-secondary ${compressMode === 'crf' ? 'active' : ''}`}
                onClick={() => setCompressMode('crf')}
                style={{ flex: 1 }}
              >
                <Sliders size={14} />
                <span>CRF / Avanzato</span>
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {COMPRESSOR_PRESETS.map((p) => (
                <div
                  key={p.id}
                  className={`preset-card ${selectedPreset === p.id ? 'active' : ''}`}
                  onClick={() => handlePresetSelect(p)}
                >
                  <div className="preset-header">
                    <span className="preset-title">{p.title}</span>
                    <span className="preset-badge">{p.tag}</span>
                  </div>
                  <span className="preset-desc">{p.desc}</span>
                </div>
              ))}
            </div>

            {/* Estimated Comparison Box */}
            <div
              style={{
                marginTop: '20px',
                padding: '14px 16px',
                background: 'rgba(230, 180, 34, 0.08)',
                border: '1px solid var(--border-gold)',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>Stima Risparmio</div>
                <div style={{ fontSize: '16px', fontWeight: 800, color: 'var(--gold-primary)' }}>
                  Circa -{estimatedSaving}% di peso
                </div>
              </div>
              <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '12.5px' }}>
                <span style={{ color: 'var(--text-dim)', textDecoration: 'line-through' }}>
                  {formatBytes(currentFile.size)}
                </span>
                <span style={{ color: 'var(--color-success)', fontWeight: 700, marginLeft: '8px' }}>
                  ~ {formatBytes(currentTargetMB * 1024 * 1024)}
                </span>
              </div>
            </div>
          </div>

          {/* Configuration Form */}
          <div className="card">
            <div className="card-header">
              <div className="card-title">
                <span>Parametri di Codifica</span>
              </div>
            </div>

            {compressMode === 'target' ? (
              <div className="form-group">
                <label className="form-label">
                  <span>Limite Peso File Target (MB)</span>
                  <span className="form-label-tag">{customTargetMB} MB</span>
                </label>
                <input
                  type="range"
                  className="range-slider"
                  min="2"
                  max="100"
                  step="1"
                  value={customTargetMB}
                  onChange={(e) => {
                    setCustomTargetMB(parseInt(e.target.value, 10));
                    setSelectedPreset('');
                  }}
                />
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  FFmpeg calcolerà il bitrate video esatto al secondo ({Math.round(((customTargetMB * 8192) / duration))} kbps) per garantire che non superi mai questo limite.
                </div>
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label">
                  <span>Fattore CRF (Constant Rate Factor): {crfValue}</span>
                  <span className="form-label-tag">
                    {crfValue <= 20 ? 'Qualità Altissima' : crfValue <= 25 ? 'Ottimale' : 'Compressione Aggressiva'}
                  </span>
                </label>
                <input
                  type="range"
                  className="range-slider"
                  min="16"
                  max="36"
                  step="1"
                  value={crfValue}
                  onChange={(e) => {
                    setCrfValue(parseInt(e.target.value, 10));
                    setSelectedPreset('');
                  }}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Velocità Preset Codifica x264</label>
              <select
                className="form-select"
                value={speedPreset}
                onChange={(e) => setSpeedPreset(e.target.value)}
              >
                <option value="ultrafast">Ultrafast (Istantaneo, file leggermente più grande)</option>
                <option value="veryfast">Veryfast (Molto veloce)</option>
                <option value="fast">Fast (Consigliato per gaming e clip)</option>
                <option value="medium">Medium (Bilanciamento perfetto)</option>
                <option value="slow">Slow (Massima efficienza di compressione)</option>
              </select>
            </div>

            <div style={{ margin: '16px 0' }}>
              <label className="toggle-wrapper">
                <div
                  className={`toggle-switch ${muteAudio ? 'on' : ''}`}
                  onClick={() => setMuteAudio(!muteAudio)}
                >
                  <div className="toggle-knob" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>Muta audio</span>
                  <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                    Rimuovendo l'audio si liberano preziosi bit da dedicare alla nitidezza video del clip.
                  </span>
                </div>
              </label>
            </div>

            <div className="form-group">
              <label className="form-label">Cartella di salvataggio</label>
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
                onClick={handleStartCompression}
              >
                <Sparkles size={16} />
                <span>Avvia Compressione Intelligente</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
