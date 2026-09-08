import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { correctWorkerEntryLog } from "@/lib/laborEvidence";
import { toast } from "sonner";

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export default function WorkerEntryCorrectForm({
  entryLogId,
  entryAt,
  exitAt,
  onDone,
}: {
  entryLogId: string;
  entryAt: string;
  exitAt: string | null;
  onDone: () => void;
}) {
  const [entry, setEntry] = useState(() => toLocalInput(entryAt));
  const [exit, setExit] = useState(() => toLocalInput(exitAt));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const nextEntry = fromLocalInput(entry);
    if (!nextEntry) {
      toast.error("입장 시각을 입력하세요");
      return;
    }
    if (!reason.trim()) {
      toast.error("정정 사유는 필수입니다");
      return;
    }
    setBusy(true);
    const res = await correctWorkerEntryLog({
      entryLogId,
      entryAt: nextEntry,
      exitAt: fromLocalInput(exit),
      reason: reason.trim(),
    });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error || "정정 실패");
      return;
    }
    toast.success("출역 시각을 정정했습니다");
    onDone();
  };

  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="text-xs font-semibold">출역 시각 정정</div>
      <p className="text-[11px] text-muted-foreground">원본은 감사 로그에 남습니다. 퇴근을 추정해 넣지 마세요.</p>
      <div>
        <Label>입장</Label>
        <Input type="datetime-local" value={entry} onChange={(e) => setEntry(e.target.value)} />
      </div>
      <div>
        <Label>퇴장</Label>
        <Input type="datetime-local" value={exit} onChange={(e) => setExit(e.target.value)} />
      </div>
      <div>
        <Label>사유</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 퇴근 버튼 누락, 본인 확인" />
      </div>
      <Button size="sm" onClick={() => void submit()} disabled={busy}>
        {busy ? "저장 중…" : "정정 저장"}
      </Button>
    </div>
  );
}
