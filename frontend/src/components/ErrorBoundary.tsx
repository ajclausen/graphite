import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <main className="app-loading" role="alert">
          <div className="g-empty">
            <h1 className="g-empty-title">Something went wrong</h1>
            <p className="g-empty-text">
              Graphite hit an unexpected error. Your saved work is safe; reloading usually fixes this.
            </p>
            <div className="g-empty-actions">
              <button className="g-btn g-btn--primary" onClick={() => window.location.reload()}>Reload</button>
              <a className="g-btn g-btn--secondary" href="#/" onClick={() => window.location.reload()}>Go to documents</a>
            </div>
            {this.state.error?.message && (
              <details className="error-details">
                <summary>Technical details</summary>
                <pre>{this.state.error.message}</pre>
              </details>
            )}
          </div>
        </main>
      );
    }

    return this.props.children;
  }
} 