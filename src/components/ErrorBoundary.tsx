import { Component } from "react";

export class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  state = { hasError: false, error: undefined as Error | undefined };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
            maxWidth: "480px",
            margin: "2rem auto",
          }}
        >
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message ?? "An unexpected error occurred."}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: undefined })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

