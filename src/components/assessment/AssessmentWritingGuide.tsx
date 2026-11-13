import { Button } from "@/components/ui/button";

export function AssessmentWritingGuide({
  hidden,
  text,
  onOpen,
  onToggle,
}: {
  hidden: boolean;
  text: string;
  onOpen: () => void;
  onToggle: () => void;
}) {
  if (hidden && text !== "이 회차는 승인되어 고칠 수 없습니다") {
    return (
      <div className="print:hidden flex justify-end">
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={onToggle}>
          가이드 보기
        </Button>
      </div>
    );
  }
  return (
    <div className="print:hidden rounded-md border bg-card px-3 py-2 flex items-start gap-2">
      <button type="button" className="text-left text-sm flex-1" onClick={onOpen}>
        <span className="block text-[11px] text-muted-foreground">작성 가이드 · 끄면 가이드 보기로 다시 엽니다</span>
        <span className="font-medium">{text}</span>
      </button>
      {text !== "이 회차는 승인되어 고칠 수 없습니다" && (
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={onToggle}>
          가이드 끄기
        </Button>
      )}
    </div>
  );
}
