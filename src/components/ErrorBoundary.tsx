import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-gray-900 text-gray-100">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">&#9888;&#65039;</div>
            <h2 className="text-lg font-bold text-red-400 mb-2">出现错误</h2>
            <p className="text-sm text-gray-400 mb-4">{this.state.error?.message}</p>
            <button
              className="px-4 py-2 bg-orange-600 hover:bg-orange-500 rounded text-sm"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
