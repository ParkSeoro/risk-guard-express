import { Button } from "@/components/ui/button";
import { Headset, X } from "lucide-react";

type Props = {
  agentLabel: string;
  status: "pending" | "active";
  controlling?: boolean;
  onEnd: () => void;
};

export function RemoteSupportSessionBanner({ agentLabel, status, controlling, onEnd }: Props) {
  const text =
    status === "pending"
      ? `${agentLabel}님에게 원격지원을 요청했습니다 · 수락 대기`
      : controlling
        ? `${agentLabel}님이 지원 중입니다 · 조작 중`
        : `${agentLabel}님이 지원 중입니다`;

  return (
    <div className="print:hidden flex items-center justify-between gap-2 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Headset className="h-4 w-4 text-amber-700 shrink-0" />
        <span className="truncate font-medium text-amber-950 dark:text-amber-100">{text}</span>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 shrink-0" onClick={onEnd}>
        <X className="h-3.5 w-3.5" />
        종료
      </Button>
    </div>
  );
}
