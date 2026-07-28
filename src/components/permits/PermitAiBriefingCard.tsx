import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sparkles, AlertTriangle, ShieldCheck, FileStack } from 'lucide-react';
import type { PermitAiBriefing } from '@/lib/permitBriefing';

interface Props {
  briefing: PermitAiBriefing | null | undefined;
  compact?: boolean;
  className?: string;
}

/** Mobile-first AI summary shown above the raw permit form for approvers. */
export default function PermitAiBriefingCard({ briefing, compact, className }: Props) {
  if (!briefing) return null;

  return (
    <Card className={`border-primary/30 bg-gradient-to-b from-primary/5 to-background ${className || ''}`}>
      <CardHeader className={compact ? 'p-3 pb-1' : 'pb-2'}>
        <CardTitle className={`flex items-center gap-2 ${compact ? 'text-sm' : 'text-base'}`}>
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          AI 핵심 요약 브리핑
          {briefing.generated_at && (
            <span className="text-[10px] font-normal text-muted-foreground ml-auto">
              {new Date(briefing.generated_at).toLocaleString('ko-KR')}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className={`space-y-3 ${compact ? 'p-3 pt-1' : 'pt-0'}`}>
        <section>
          <div className="text-[11px] font-semibold text-muted-foreground mb-1">1) 작업 개요</div>
          <p className={`${compact ? 'text-sm' : 'text-sm'} leading-relaxed`}>{briefing.work_overview}</p>
        </section>

        <section>
          <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
            <FileStack className="h-3 w-3" /> 2) 포함된 허가서 종류
          </div>
          <div className="flex flex-wrap gap-1">
            {(briefing.included_kinds || []).map((k) => (
              <Badge key={k} variant="secondary" className="text-xs">{k}</Badge>
            ))}
          </div>
        </section>

        <section>
          <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-destructive" /> 3) 치명적 위험 요인 Top 3
          </div>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {(briefing.top_risks || []).slice(0, 3).map((r, i) => (
              <li key={i} className="leading-snug">{r}</li>
            ))}
          </ol>
        </section>

        <section>
          <div className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-emerald-600" /> 4) 필수 점검 안전 조치
          </div>
          <ul className="space-y-1 text-sm">
            {(briefing.required_controls || []).map((c, i) => (
              <li key={i} className="flex gap-2 leading-snug">
                <span className="text-emerald-600 shrink-0">✓</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
    </Card>
  );
}
