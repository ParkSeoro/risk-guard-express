import { useState } from 'react';
import { HelpCircle, BookOpen, ChevronDown, ChevronUp } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import type { SectionLegalHint } from '@/lib/workPlanGuides';

interface Props {
  hint: SectionLegalHint;
}

export default function LegalTermTooltip({ hint }: Props) {
  const [showExample, setShowExample] = useState(false);

  return (
    <Popover onOpenChange={(open) => { if (!open) setShowExample(false); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-full h-5 w-5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          aria-label={`${hint.term} 법령 도움말`}
          title={`${hint.term} 도움말·KOSHA 예시 보기`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 sm:w-96 p-3 space-y-2 text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-foreground">{hint.term}</span>
            <Badge variant="outline" className="text-[9px] h-4 font-normal">
              {hint.legalBasis}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            {hint.plainExplanation}
          </p>
        </div>
        <div className="pt-1 border-t">
          <button
            type="button"
            onClick={() => setShowExample((v) => !v)}
            className="w-full flex items-center justify-between text-[11px] font-medium text-primary hover:underline py-0.5"
          >
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3 w-3" /> KOSHA 표준 작성 예시 {showExample ? '접기' : '보기'}
            </span>
            {showExample ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {showExample && (
            <pre className="mt-1.5 rounded bg-muted/60 border p-2 text-[11px] whitespace-pre-wrap font-sans leading-relaxed text-foreground">
              {hint.koshaExample}
            </pre>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
