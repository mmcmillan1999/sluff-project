// frontend/src/components/ErrorBoundary.js
import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        // Log the error for debugging
        console.error('ErrorBoundary caught an error:', error);
        console.error('Error info:', errorInfo);
        
        this.setState({
            error: error,
            errorInfo: errorInfo
        });

        // You could also log the error to an error reporting service here
        if (this.props.onError) {
            this.props.onError(error, errorInfo);
        }
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    }

    render() {
        if (this.state.hasError) {
            // Fallback UI
            return (
                <div style={{
                    padding: '20px',
                    textAlign: 'center',
                    backgroundColor: '#f8f9fa',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    margin: '20px'
                }}>
                    <h2 style={{ color: '#dc3545' }}>Something went wrong</h2>
                    <p>We're sorry, but something unexpected happened.</p>
                    <button 
                        onClick={this.handleReset}
                        style={{
                            backgroundColor: '#007bff',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            margin: '10px'
                        }}
                    >
                        Try Again
                    </button>
                    <button 
                        onClick={() => window.location.reload()}
                        style={{
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            padding: '10px 20px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            margin: '10px'
                        }}
                    >
                        Reload Page
                    </button>
                    {process.env.NODE_ENV === 'development' && (
                        <details style={{ marginTop: '20px', textAlign: 'left' }}>
                            <summary>Error Details (Development Only)</summary>
                            <pre style={{ 
                                backgroundColor: '#f8f9fa', 
                                padding: '10px', 
                                overflow: 'auto',
                                fontSize: '12px'
                            }}>
                                {this.state.error && this.state.error.toString()}
                                {this.state.errorInfo.componentStack}
                            </pre>
                        </details>
                    )}
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;