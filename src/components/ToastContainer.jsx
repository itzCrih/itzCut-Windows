import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => {
        const isSuccess = toast.type === 'success';
        const isError = toast.type === 'error';

        return (
          <div key={toast.id} className={`toast-item ${toast.type} ${toast.exiting ? 'exiting' : ''}`}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {isSuccess && <CheckCircle2 size={18} color="#2ea043" />}
              {isError && <AlertCircle size={18} color="#f85149" />}
              {!isSuccess && !isError && <Info size={18} color="#e6b422" />}
            </div>

            <div style={{ flex: 1, fontSize: '13px', lineHeight: '1.4' }}>
              {toast.message}
            </div>

            <button
              onClick={() => onDismiss(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
