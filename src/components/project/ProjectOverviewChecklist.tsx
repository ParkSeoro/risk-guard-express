import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';
import type { ProjectDetailTabId } from '@/lib/projectTradeTags';

interface Props {
  hasLocationCoords: boolean;
  companyCount: number;
  gcCount: number;
  missingConstructionCount: number;
  memberCount: number;
  permitFormLabel?: string | null;
  onJumpTab: (tab: ProjectDetailTabId) => void;
}

export default function ProjectOverviewChecklist({
  hasLocationCoords,
  companyCount,
  gcCount,
  missingConstructionCount,
  memberCount,
  permitFormLabel,
  onJumpTab,
}: Props) {
  const items: Array<{
    id: string;
    label: string;
    value: string;
    state: 'ok' | 'warn' | 'todo';
    target: ProjectDetailTabId;
  }> = [
    {
      id: 'location',
      label: '주소 · 날씨',
      value: hasLocationCoords ? '연동됨' : '주소 미등록',
      state: hasLocationCoords ? 'ok' : 'warn',
      target: 'basic-info',
    },
    {
      id: 'companies',
      label: '참여 업체',
      value: companyCount > 0 ? `${companyCount}곳 (시공사 ${gcCount})` : '미등록',
      state: gcCount > 0 ? 'ok' : companyCount > 0 ? 'warn' : 'todo',
      target: 'companies',
    },
    {
      id: 'construction',
      label: '공사금액 · 기간',
      value:
        companyCount === 0
          ? '업체 없음'
          : missingConstructionCount === 0
            ? '모두 입력됨'
            : `미입력 ${missingConstructionCount}곳`,
      state:
        companyCount === 0
          ? 'todo'
          : missingConstructionCount === 0
            ? 'ok'
            : 'warn',
      target: 'companies',
    },
    {
      id: 'members',
      label: '멤버 · 권한',
      value: `${memberCount}명`,
      state: memberCount > 1 ? 'ok' : 'warn',
      target: 'members',
    },
    {
      id: 'permit-form',
      label: '허가서 양식',
      value: permitFormLabel || '기본 표준',
      state: 'ok',
      target: 'integrations',
    },
  ];

  return (
    <Card className="border-border/70">
      <CardContent className="p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onJumpTab(item.target)}
              className={`flex items-start gap-2 rounded-md border p-2 text-left transition-colors hover:bg-muted/50 ${
                item.state === 'warn'
                  ? 'border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20'
                  : item.state === 'ok'
                    ? 'border-emerald-500/25 bg-emerald-50/30 dark:bg-emerald-950/10'
                    : 'border-border bg-muted/20'
              }`}
            >
              {item.state === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              ) : item.state === 'warn' ? (
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">{item.label}</p>
                <p className="text-xs font-semibold truncate">{item.value}</p>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
