import React, { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AlertCircle, RefreshCw, LogOut, Copy, Check, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AuthErrorScreenProps {
  title?: string;
  description?: string;
  onRetry?: () => Promise<void> | void;
}

const FIX_SQL = `-- Supabase SQL Editor에서 실행하여 권한을 복구하세요:
GRANT EXECUTE ON FUNCTION public.is_master(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;`;

export function AuthErrorScreen({
  title = "계정 정보를 불러올 수 없습니다",
  description = "데이터베이스 권한 설정 문제 또는 세션 확인 오류로 인해 사용자 정보를 가져오지 못했습니다.",
  onRetry,
}: AuthErrorScreenProps) {
  const { authError, reloadAuthProfile, retryAuthBootstrap, signOut } = useAuth();
  const [isRetrying, setIsRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleRetry = async () => {
    setIsRetrying(true);
    try {
      if (onRetry) {
        await onRetry();
      } else if (retryAuthBootstrap) {
        await retryAuthBootstrap();
      } else {
        await reloadAuthProfile();
      }
    } catch (e) {
      console.error("Retry failed:", e);
    } finally {
      setIsRetrying(false);
    }
  };

  const handleCopySql = () => {
    void navigator.clipboard.writeText(FIX_SQL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const isPermissionError =
    authError &&
    (authError.includes("permission denied") ||
      authError.includes("42501") ||
      authError.includes("is_master") ||
      authError.includes("is_project_member"));

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-lg bg-card border border-border rounded-xl shadow-lg p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-full bg-destructive/10 text-destructive shrink-0">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-foreground">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
        </div>

        {authError && (
          <div className="p-3.5 rounded-lg bg-muted text-xs font-mono text-muted-foreground border border-border break-all">
            <div className="font-semibold text-destructive mb-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              오류 상세 내용
            </div>
            {authError}
          </div>
        )}

        {isPermissionError && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs space-y-2.5">
            <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              💡 데이터베이스 함수 권한(is_master) 복구 필요
            </div>
            <p className="text-muted-foreground">
              Supabase 데이터베이스의 <code className="text-xs bg-muted px-1 py-0.5 rounded">is_master</code> 함수 실행 권한이 누락되어 발생한 오류입니다. Supabase 대시보드의 <strong>SQL Editor</strong>에서 아래 쿼리를 실행해 주시면 즉시 해결됩니다.
            </p>
            <div className="relative">
              <pre className="p-2.5 bg-background border rounded font-mono text-[11px] overflow-x-auto text-foreground/90">
                {FIX_SQL}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2 h-7 px-2 text-[11px] gap-1 bg-background"
                onClick={handleCopySql}
              >
                {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                {copied ? "복사됨" : "SQL 복사"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-end gap-2.5 pt-2 border-t border-border">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full sm:w-auto text-muted-foreground hover:text-foreground gap-1.5"
            onClick={() => void signOut()}
          >
            <LogOut className="w-4 h-4" />
            로그아웃
          </Button>

          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={isRetrying}
            className="w-full sm:w-auto gap-1.5"
            onClick={handleRetry}
          >
            <RefreshCw className={`w-4 h-4 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "확인 중…" : "다시 시도"}
          </Button>
        </div>
      </div>
    </div>
  );
}
