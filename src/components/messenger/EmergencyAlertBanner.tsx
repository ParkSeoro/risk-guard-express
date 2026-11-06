import { useState } from "react";
import { AlertTriangle, ShieldAlert, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { messengerType } from "@/lib/messengerType";

interface EmergencyAlertBannerProps {
  title?: string;
  description?: string;
  level?: "critical" | "warning" | "info";
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmergencyAlertBanner({
  title = "🚨 현장 긴급 안전 경보",
  description = "기상 악화 또는 위험 작업 구역 작업중지 명령이 발령되었습니다. 안전 지침을 확인하세요.",
  level = "critical",
  actionLabel = "대응 지침 확인",
  onAction,
  className,
}: EmergencyAlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const isCritical = level === "critical";

  return (
    <div
      role="alert"
      className={cn(
        "px-3 py-2 border-b flex items-center justify-between gap-2.5 transition-all shadow-xs animate-in slide-in-from-top-1 shrink-0",
        isCritical
          ? "bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-300"
          : "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="relative flex h-3 w-3 shrink-0">
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              isCritical ? "bg-red-500" : "bg-amber-500",
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full h-3 w-3",
              isCritical ? "bg-red-600" : "bg-amber-600",
            )}
          />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn("font-bold truncate", messengerType.preview)}>{title}</span>
          </div>
          {description && (
            <p className={cn("opacity-90 truncate max-w-[280px] sm:max-w-md", messengerType.meta)}>
              {description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {onAction && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAction}
            className={cn(
              "h-7 px-2.5 gap-1 font-semibold rounded-md border shadow-none",
              isCritical
                ? "bg-red-600 hover:bg-red-700 text-white border-red-600"
                : "bg-amber-600 hover:bg-amber-700 text-white border-amber-600",
              messengerType.meta,
            )}
          >
            <span>{actionLabel}</span>
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => setDismissed(true)}
          className="h-6 w-6 opacity-70 hover:opacity-100"
          aria-label="경보 닫기"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
