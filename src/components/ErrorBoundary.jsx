import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#07090e',
            color: '#e6edf3',
            fontFamily: 'system-ui, sans-serif',
            padding: '30px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              padding: '24px 32px',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: '12px',
              maxWidth: '520px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <h2 style={{ color: '#e6b422', margin: '0 0 12px 0', fontSize: '20px' }}>
              itzCut Desktop — Recovery Mode
            </h2>
            <p style={{ color: '#8b949e', fontSize: '14px', lineHeight: '1.5', margin: '0 0 20px 0' }}>
              An unexpected interface error occurred. You can safely reload the application.
            </p>
            {this.state.error && (
              <pre
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#f85149',
                  textAlign: 'left',
                  overflowX: 'auto',
                  marginBottom: '20px',
                }}
              >
                {this.state.error.toString()}
              </pre>
            )}
            <button
              onClick={this.handleReload}
              style={{
                background: 'linear-gradient(135deg, #e6b422 0%, #b8860b 100%)',
                color: '#000',
                border: 'none',
                padding: '10px 24px',
                borderRadius: '8px',
                fontWeight: 'bold',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
