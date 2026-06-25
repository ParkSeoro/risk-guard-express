import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2, X } from "lucide-react";

type CreditStatus = "ok" | "rate_limited" | "exhausted" | "error" | "loading";

interface CreditState {
  status: CreditStatus;
  message: string;
  checked_at?: string;
}

export function AICreditBanner() {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [state, setState] = useState<CreditState | null>(null);

  const check = useCallback(async () => {
    setState({ status: "loading", message: "확인 중..." });
    const { data, error } = await supabase.functions.invoke("check-ai-credits");
    if (error || !data) {
      setState({ status: "error", message: error?.message || "확인 실패" });
      return;
    }
    setState({
      status: data.status as CreditStatus,
      message: data.message,
      checked_at: data.checked_at,
    });
  }, []);

  if (!isMaster) return null;

  // 결과 없으면 헤더 옆 작은 버튼만
  if (!state) {
    return (
      <button
        type="button"
        onClick={check}
        className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-secondary text-secondary-foreground border text-[11px] hover:bg-muted transition"
        title="AI 크레딧 잔액/소진 상태 확인 (마스터 전용)"
      >
        <Sparkles className="h-3 w-3" />
        <span>AI 크레딧 확인</span>
      </button>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-muted-foreground text-[11px]">
        <Sparkles className="h-3 w-3 animate-pulse" />
        <span>AI 크레딧 확인 중...</span>
      </div>
    );
  }

  if (state.status === "ok") {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px]">
        <CheckCircle2 className="h-3 w-3" />
        <span>AI 크레딧 정상</span>
        <button
          type="button"
          onClick={check}
          className="ml-1 hover:bg-emerald-100 rounded p-0.5"
          title="다시 확인"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => setState(null)}
          className="hover:bg-emerald-100 rounded p-0.5"
          title="닫기"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // 경고/오류 → 전폭 배너
  const color =
    state.status === "exhausted"
      ? "bg-destructive/10 text-destructive border-destructive/30"
      : state.status === "rate_limited"
      ? "bg-amber-50 text-amber-800 border-amber-300"
      : "bg-orange-50 text-orange-800 border-orange-300";

  return (
    <div className={`w-full px-4 py-2 border-b text-xs flex items-center justify-between gap-3 ${color}`}>
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="font-medium shrink-0">AI 크레딧 상태 (마스터 전용):</span>
        <span className="truncate">{state.message}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={check}>
          <RefreshCw className="h-3 w-3 mr-1" />
          다시 확인
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0"
          onClick={() => setState(null)}
          title="닫기"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
