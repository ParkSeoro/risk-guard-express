import React from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toKoreanWarning } from "@/lib/errors";
import { isStaleChunkError, STALE_CHUNK_PAGE_MESSAGE } from "@/lib/staleChunkError";
import {
  IOS_SHAREABLE_PAGE_MESSAGE,
  isShareableRuntimeError,
  recoverIosWebRuntimeOnce,
} from "@/lib/iosShareableGuard";

interface State { error: Error | null; }

export class AppErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[AppErrorBoundary]", error, info.componentStack);
    if (isShareableRuntimeError(error)) {
      void recoverIosWebRuntimeOnce();
    }
  }

  reset = () => this.setState({ error: null });

  goHome = () => {
    this.reset();
    window.location.assign("/");
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback !== undefined) return this.props.fallback;

      const isStale = isStaleChunkError(this.state.error);
      const isIos = isShareableRuntimeError(this.state.error);

      // 시스템 코드 업데이트로 인한 새로고침 화면 — 오류가 아닌 업데이트 안내 UI 제공
      if (isStale) {
        return (
          <div className="min-h-screen bg-background flex items-center justify-center p-6 native-safe-pad">
            <div className="max-w-md w-full bg-card border-2 border-primary/20 rounded-xl p-6 shadow-lg space-y-4 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <RefreshCw className="h-6 w-6 animate-spin" />
              </div>
              <div className="space-y-1">
                <h2 className="font-bold text-lg text-foreground">시스템 최신 버전 업데이트</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  새로운 기능 및 안정화 패치가 배포되었습니다.<br />
                  최신 화면을 반영하기 위해 페이지를 새로고침합니다.
                </p>
              </div>
              <div className="pt-2 flex justify-center gap-2">
                <Button onClick={() => { this.reset(); window.location.reload(); }} size="sm">
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> 최신 버전 적용하기
                </Button>
                <Button onClick={this.goHome} size="sm" variant="outline">
                  <Home className="h-3.5 w-3.5 mr-1.5" /> 첫 화면
                </Button>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-background flex items-center justify-center p-6 native-safe-pad">
          <div className="max-w-md w-full bg-card border-2 border-destructive/30 rounded-xl p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <h2 className="font-bold text-lg">화면을 불러오지 못했습니다</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              {isIos
                ? IOS_SHAREABLE_PAGE_MESSAGE
                : "화면을 그리는 중 오류가 발생했습니다."}
            </p>
            {!isIos && (
              <pre className="text-xs bg-muted/50 rounded p-2 overflow-auto max-h-32 whitespace-pre-wrap">
                {toKoreanWarning(this.state.error)}
              </pre>
            )}
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
