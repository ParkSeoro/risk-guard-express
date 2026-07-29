import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State { error: Error | null; }

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  goHome = () => {
    this.reset();
    window.location.assign("/");
  };

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-card border-2 border-destructive/30 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="font-bold text-lg">화면을 불러오지 못했습니다</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              데이터를 불러오는 중 오류가 발생했습니다. (상세 원인)
            </p>
            <pre className="text-xs bg-muted/50 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2">
              <Button onClick={() => { this.reset(); window.location.reload(); }} size="sm">
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> 재시도
              </Button>
              <Button onClick={this.goHome} size="sm" variant="outline">
                <Home className="h-3.5 w-3.5 mr-1" /> 첫 화면
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
