import React from 'react';
import { RefreshCw, Scissors, Layers, Settings } from 'lucide-react';
import BrandLogo from './BrandLogo';

export default function Navbar({ activeTab, setActiveTab, activeJobsCount, onResetApp }) {
  const tabs = [
    { id: 'convert', label: 'Convert & Compress', icon: RefreshCw },
    { id: 'trim', label: 'Trimmer', icon: Scissors },
    { id: 'queue', label: 'Queue', icon: Layers, count: activeJobsCount },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleOpenDiscord = () => {
    if (window.itzCutAPI) {
      window.itzCutAPI.openExternal('https://community.itzcrih.it');
    }
  };

  return (
    <nav className="navbar">
      <div className="navbar-brand-section">
        <BrandLogo onClick={onResetApp} />
      </div>

      <div className="nav-tabs">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`nav-tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              {tab.count > 0 && <span className="nav-badge-count">{tab.count}</span>}
            </button>
          );
        })}
      </div>

      <div className="nav-right-actions">
        {/* Discord Community Button */}
        <button
          className="btn-discord"
          onClick={handleOpenDiscord}
          title="Join our Discord community (community.itzcrih.it)"
        >
          <svg width="16" height="13" viewBox="0 0 24 19" fill="currentColor">
            <path d="M20.317 1.492a19.78 19.78 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 1.492.07.07 0 0 0 3.645 1.52C.303 6.516-.603 11.385.455 16.19a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.893.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-14.668a.061.061 0 0 0-.031-.028zM8.02 12.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
          </svg>
          <span>Discord</span>
        </button>
      </div>
    </nav>
  );
}
