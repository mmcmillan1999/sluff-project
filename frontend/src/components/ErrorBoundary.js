import React from 'react';

// App-wide error boundary: a single component crash should not white-screen the
// whole app (especially inside a native WebView with no address bar to reload).
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        // eslint-disable-next-line no-console
        console.error('[ErrorBoundary] Caught a render error:', error, info?.componentStack);
    }

    handleReload = () => {
        try {
            window.location.reload();
        } catch {
            this.setState({ hasError: false, error: null });
        }
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }
        return (
            <div style={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                padding: '24px',
                textAlign: 'center',
                background: '#1f2a24',
                color: '#eee',
                fontFamily: 'system-ui, sans-serif',
            }}>
                <div style={{ fontSize: '2rem' }}>🃏</div>
                <h2 style={{ margin: 0 }}>Something went wrong</h2>
                <p style={{ margin: 0, color: '#9fb3a8', maxWidth: '32ch' }}>
                    The app hit an unexpected error. Reloading usually fixes it.
                </p>
                <button
                    onClick={this.handleReload}
                    style={{
                        background: '#7fd6a8',
                        color: '#11201a',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '12px 22px',
                        fontWeight: 600,
                        fontSize: '1rem',
                        cursor: 'pointer',
                    }}
                >
                    Reload
                </button>
            </div>
        );
    }
}

export default ErrorBoundary;
