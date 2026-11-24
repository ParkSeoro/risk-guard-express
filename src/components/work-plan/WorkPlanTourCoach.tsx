import { useState } from 'react';
import { Sparkles, ChevronLeft, ChevronRight, X, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  WORK_PLAN_TOUR_STEPS,
  markWorkPlanTourSeen,
} from '@/lib/workPlanGuides';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectTab?: (tab: string) => void;
}

export default function WorkPlanTourCoach({ open, onClose, onSelectTab }: Props) {
  const [stepIdx, setStepIdx] = useState(0);

  if (!open) return null;

  const step = WORK_PLAN_TOUR_STEPS[stepIdx] ?? WORK_PLAN_TOUR_STEPS[0];
  const isFirst = stepIdx === 0;
  const isLast = stepIdx === WORK_PLAN_TOUR_STEPS.length - 1;

  const handleDismiss = (remember: boolean) => {
    if (remember) markWorkPlanTourSeen();
    setStepIdx(0);
    onClose();
  };

  const goTo = (nextIdx: number) => {
    setStepIdx(nextIdx);
    const nextStep = WORK_PLAN_TOUR_STEPS[nextIdx];
    if (nextStep?.targetTab) {
      onSelectTab?.(nextStep.targetTab);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="작업계획서 화면 안내"
      className="rounded-xl border-2 border-primary/40 bg-primary/5 p-3.5 shadow-sm space-y-2.5 print:hidden"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="default" className="text-[10px] h-5 gap-1">
            <Sparkles className="h-3 w-3" /> 30초 화면 안내 ({step.stepNumber}/{WORK_PLAN_TOUR_STEPS.length})
          </Badge>
          <span className="text-xs font-bold text-foreground">{step.title}</span>
        </div>
        <button
          type="button"
          onClick={() => handleDismiss(true)}
          className="text-muted-foreground hover:text-foreground p-0.5 rounded"
          aria-label="안내 닫기"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-foreground/90 leading-relaxed">{step.body}</p>
      <p className="text-[11px] text-primary bg-background/80 rounded border border-primary/20 px-2.5 py-1.5">
        💡 {step.tip}
      </p>

      <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
        <div className="flex items-center gap-1">
          {WORK_PLAN_TOUR_STEPS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(idx)}
              aria-label={`${s.stepNumber}단계`}
              className={`h-2 rounded-full transition-all ${
                idx === stepIdx ? 'w-5 bg-primary' : 'w-2 bg-primary/30 hover:bg-primary/50'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => handleDismiss(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground underline mr-1"
          >
            다시 보지 않기
          </button>
          {step.targetTab && onSelectTab && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={() => onSelectTab(step.targetTab!)}
            >
              해당 탭 보기 <ArrowRight className="h-3 w-3" />
            </Button>
          )}
          {!isFirst && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] gap-0.5"
              onClick={() => goTo(stepIdx - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> 이전
            </Button>
          )}
          {!isLast ? (
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px] gap-0.5"
              onClick={() => goTo(stepIdx + 1)}
            >
              다음 <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => handleDismiss(true)}
            >
              안내 완료
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
