import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";

type CreditStatus = "ok" | "rate_limited" | "exhausted" | "error" | "loading";

interface CreditState {
  status: CreditStatus;
  message: string;
  checked_at?: string;
}

const CACHE_KEY = "ai_credit_status_v1";
const TTL_MS = 5 * 60 * 1000; // 5분

export function AICreditBanner() {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [state, setState] = useState<CreditState>({ status: "loading", message: "확인 중..." });

  const check = useCallback(async (force = false) => {
    if (!force) {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as CreditState & { ts: number };
          if (Date.now() - parsed.ts < TTL_MS) {
            setState(parsed);
            return;
          }
        }
      } catch {}
    }
    setState({ status: "loading", message: "확인 중..." });
    const { data, error } = await supabase.functions.invoke("check-ai-credits");
    if (error || !data) {
      const next: CreditState = { status: "error", message: error?.message || "확인 실패" };
      setState(next);
      return;
    }
    const next: CreditState = {
      status: data.status as CreditStatus,
      message: data.message,
      checked_at: data.checked_at,
    };
    setState(next);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...next, ts: Date.now() }));
    } catch {}
  }, []);

  useEffect(() => {
    if (!isMaster) return;
    check();
  }, [isMaster, check]);

  if (!isMaster) return null;

  // 정상이면 컴팩트 칩만 표시 (헤더 영역에 배치)
  if (state.status === "ok") {
    return (
      <button
        type="button"
        onClick={() => check(true)}
        className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] hover:bg-emerald-100 transition"
        title={`AI 크레딧 정상 · ${state.checked_at ? new Date(state.checked_at).toLocaleTimeString("ko-KR") : ""} 확인`}
      >
        <CheckCircle2 className="h-3 w-3" />
        <span>AI 크레딧 정상</span>
      </button>
    );
  }

  if (state.status === "loading") {
    return (
      <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-muted-foreground text-[11px]">
        <Sparkles className="h-3 w-3 animate-pulse" />
        <span>AI 크레딧 확인 중</span>
      </div>
    );
  }

  // 경고 상태는 전폭 배너
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
        <span className="font-medium shrink-0">AI 크레딧 알림 (마스터 전용):</span>
        <span className="truncate">{state.message}</span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs"
        onClick={() => check(true)}
      >
        <RefreshCw className="h-3 w-3 mr-1" />
        다시 확인
      </Button>
    </div>
  );
}
