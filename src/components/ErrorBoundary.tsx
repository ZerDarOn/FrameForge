import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** 自定义错误回退 UI，不提供则全屏显示 */
  fallback?: ReactNode;
  /** 面板名称，用于错误日志 */
  name?: string;
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

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      // 默认：全屏错误页（仅顶层使用）
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

/** 面板级错误回退 —— 灰色占位块，提示该面板崩溃 */
export function PanelErrorFallback(label: string) {
  return (
    <div className="flex items-center justify-center h-full bg-gray-900/50 text-gray-500 text-xs">
      <div className="text-center">
        <div className="text-lg mb-1">⚠</div>
        <div>{label} 加载失败</div>
        <button
          className="mt-2 px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-[10px]"
          onClick={() => window.location.reload()}
        >
          重载
        </button>
      </div>
    </div>
  );
}
