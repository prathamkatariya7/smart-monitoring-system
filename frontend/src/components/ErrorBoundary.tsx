import React from 'react';
import { Result, Button, Typography } from 'antd';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary: catches unhandled render/lifecycle errors and
 * shows a user-friendly fallback instead of a white screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
          <Result
            status="error"
            title="Something went wrong"
            subTitle={
              <Typography.Text type="secondary" style={{ whiteSpace: 'pre-wrap' }}>
                {this.state.error?.message ?? 'An unexpected error occurred.'}
              </Typography.Text>
            }
            extra={
              <Button type="primary" onClick={this.handleReload}>
                Reload Page
              </Button>
            }
          />
        </div>
      );
    }

    return this.props.children;
  }
}

