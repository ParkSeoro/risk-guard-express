import { AlertTriangle, CheckCircle2, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface ReadinessItem {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
  jump?: 'items' | 'participation' | 'approval' | 'run';
}

interface Props {
  ready: boolean;
  items: ReadinessItem[];
  onJump: (jump?: 'items' | 'participation' | 'approval' | 'run') => void;
}

export function AssessmentReadinessPopover({ ready, items, onJump }: Props) {
  const passed = items.filter((i) => i.ok).length;
  const total = items.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className={`h-8 text-xs gap-1.5 ${
            ready
              ? 'border-success/40 bg-success/10 text-success hover:bg-success/15'
              : 'border-warning/50 bg-warning/10 text-warning hover:bg-warning/15'
          }`}
        >
          {ready ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )}
          <span>{ready ? `상신 준비됨 (${passed}/${total})` : `상신 준비 ${passed}/${total}`}</span>
          <ChevronDown className="h-3 w-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs">
          결재 상신 전 점검 ({passed}/{total})
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            onClick={() => item.jump && onJump(item.jump)}
            className="flex items-start justify-between gap-2 text-xs py-2 cursor-pointer"
          >
            <div className="flex items-start gap-1.5 min-w-0">
              {item.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <div className={item.ok ? 'text-foreground' : 'font-medium text-foreground'}>
                  {item.label}
                </div>
                {item.detail && (
                  <div className="text-[11px] text-muted-foreground truncate">{item.detail}</div>
                )}
              </div>
            </div>
            <span className="text-[11px] shrink-0 text-primary">
              {item.ok ? '완료' : '이동 →'}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
