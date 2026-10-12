import React, { useEffect, useState } from 'react';
import { Minus, Square, X, Copy } from 'lucide-react';
import logoImg from '../assets/logo.png';

export default function TitleBar({ currentFile, onResetApp }) {
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    if (window.itzCutAPI) {
      window.itzCutAPI.isMaximized().then(setIsMax);
    }
  }, []);

  const handleMinimize = () => {
    if (window.itzCutAPI) window.itzCutAPI.minimizeWindow();
  };

  const handleMaximize = async () => {
    if (window.itzCutAPI) {
      window.itzCutAPI.maximizeWindow();
      const maximized = await window.itzCutAPI.isMaximized();
      setIsMax(maximized);
    }
  };

  const handleClose = () => {
    if (window.itzCutAPI) window.itzCutAPI.closeWindow();
  };

  return (
    <div className="app-titlebar">
      <div className="titlebar-left">
        <div
          className="titlebar-brand"
          onClick={onResetApp}
          style={{ cursor: 'pointer' }}
          title="Reset application & return to Home"
        >
          <img
            src={logoImg}
            alt="itzCut"
            className="titlebar-logo-img brand-icon-rounded-box"
            style={{ width: '20px', height: '20px', objectFit: 'contain', borderRadius: '4px' }}
          />
          <span className="brand-logo-text" style={{ fontSize: '13px' }}>itzCut</span>
          <span className="titlebar-badge">Desktop</span>
        </div>
      </div>

      <div className="titlebar-center">
        {currentFile ? (
          <span>{currentFile.name} — Lightweight video renderer</span>
        ) : (
          <span>itzCut Desktop — Lightweight video renderer</span>
        )}
      </div>

      <div className="titlebar-right">
        <button className="win-control-btn" onClick={handleMinimize} title="Minimize">
          <Minus size={14} />
        </button>
        <button className="win-control-btn" onClick={handleMaximize} title={isMax ? 'Restore' : 'Maximize'}>
          {isMax ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button className="win-control-btn close" onClick={handleClose} title="Close">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
