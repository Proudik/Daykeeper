import { Component, type ReactNode } from 'react';
import { logCrash } from '@/lib/errorLogger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-time crashes in the React tree, logs them to audit_log,
 and shows a fallback UI instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    const detail = `${error.message}\n\nJS Stack:\n${error.stack ?? '(none)'}\n\nReact Component Stack:\n${info.componentStack ?? '(none)'}`;
    logCrash(error.message, detail);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
          <div className="max-w-md text-center">
            <h1 className="mb-2 text-lg font-semibold text-stone-900">
              Something went wrong
            </h1>
            <p className="mb-4 text-sm text-stone-500">
              An unexpected error occurred. The team has been notified. Reload the page to continue.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
