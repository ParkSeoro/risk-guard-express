/**
 * In-shell page title — use on tab roots instead of a second primary sticky header.
 * Sub-pages that need back can pass onBack.
 */
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

export default function MobilePageHeader({
  title,
  subtitle,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Prefer navigate(-1) or a parent tab path — not a full primary bar. */
  onBack?: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      className="flex items-start justify-between gap-2 px-4 pt-3 pb-2"
      data-testid="mobile-page-header"
    >
      <div className="flex items-start gap-2 min-w-0">
        {onBack && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 -ml-1"
            onClick={onBack}
            aria-label="뒤로"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight truncate">{title}</h1>
          {subtitle ? (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-1 shrink-0">{actions}</div> : null}
    </div>
  );
}
