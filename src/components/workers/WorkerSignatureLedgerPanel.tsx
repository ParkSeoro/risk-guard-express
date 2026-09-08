import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PenLine } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useAuditLog } from "@/hooks/useAuditLog";
import { todaySeoulDate } from "@/lib/dailyWorkAck";
import { addSeoulDays } from "@/lib/workHours";
import {
  fetchSignatureLedger,
  resolvePledgeText,
  type SignatureKind,
  type SignatureLedgerRow,
} from "@/lib/laborEvidence";
import SignaturePreview from "@/components/workers/SignaturePreview";

const KINDS: Array<{ id: "all" | SignatureKind; label: string }> = [
  { id: "all", label: "전체" },
  { id: "daily_ack", label: "일일서약" },
  { id: "no_accident", label: "무재해" },
  { id: "tbm", label: "TBM" },
  { id: "ra_share", label: "RA 공유" },
  { id: "ppe", label: "보호구" },
];

export default function WorkerSignatureLedgerPanel({
  workerId,
  projectId: projectIdProp,
}: {
  workerId?: string;
  projectId?: string;
}) {
  const { projectId: activeProjectId } = useActiveProject();
  const projectId = projectIdProp || activeProjectId;
  const { log } = useAuditLog();
  const today = todaySeoulDate();
  const [from, setFrom] = useState(() => addSeoulDays(today, -30));
  const [to, setTo] = useState(today);
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SignatureLedgerRow[]>([]);
  const [selected, setSelected] = useState<SignatureLedgerRow | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    fetchSignatureLedger({ projectId, workerId, from, to })
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .catch((e) => toast.error(e.message || "서명 원장 로드 실패"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workerId, from, to]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (kind !== "all" && r.kind !== kind) return false;
      if (!q) return true;
      return (
        r.workerName.toLowerCase().includes(q) ||
        (r.companyName || "").toLowerCase().includes(q) ||
        (r.detail || "").toLowerCase().includes(q)
      );
    });
  }, [rows, kind, search]);

  const openRow = (r: SignatureLedgerRow) => {
    setSelected(r);
    void log("view", "worker_signature", r.id, projectId || undefined, { kind: r.kind, workerId: r.workerId });
  };

  return (
    <div className="space-y-4">
      {!workerId && (
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <PenLine className="h-5 w-5" /> 서명·서약 원장
          </h2>
          <p className="text-xs text-muted-foreground mt-1">일일서약·무재해·TBM·위험성평가 공유·보호구 수령 서명을 한 곳에서 확인합니다.</p>
        </div>
      )}

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div>
            <Label>시작</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label>종료</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label>종류</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.id} value={k.id}>{k.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Label>검색</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="이름·소속" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">서명 {filtered.length}건</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">서명 기록이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="text-left p-2">시각</th>
                    {!workerId && <th className="text-left p-2">근로자</th>}
                    <th className="text-left p-2">종류</th>
                    <th className="text-left p-2">내용</th>
                    <th className="text-left p-2">서명</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={`${r.kind}-${r.id}`} className="border-b cursor-pointer hover:bg-muted/40" onClick={() => openRow(r)}>
                      <td className="p-2 text-xs">{r.signedAt ? new Date(r.signedAt).toLocaleString("ko-KR") : r.workDate}</td>
                      {!workerId && (
                        <td className="p-2">
                          <div className="font-medium">{r.workerName || "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.companyName || ""}</div>
                        </td>
                      )}
                      <td className="p-2"><Badge variant="outline">{r.kindLabel}</Badge></td>
                      <td className="p-2 text-xs max-w-[240px] truncate">{r.detail || "—"}</td>
                      <td className="p-2">{r.signatureData ? "있음" : "없음"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.kindLabel} 서명</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-3 text-sm">
              <div>
                {selected.workerId ? (
                  <Link className="font-medium underline-offset-2 hover:underline" to={`/app/admin/workers/${selected.workerId}`}>
                    {selected.workerName}
                  </Link>
                ) : (
                  <span className="font-medium">{selected.workerName}</span>
                )}
                <div className="text-xs text-muted-foreground">{selected.companyName}</div>
              </div>
              <div className="text-xs text-muted-foreground">
                {selected.signedAt ? new Date(selected.signedAt).toLocaleString("ko-KR") : selected.workDate}
              </div>
              {selected.kind === "ra_share" && (
                <Button asChild variant="outline" size="sm">
                  <Link to="/app/admin/assessment-notices">위험성평가 공지</Link>
                </Button>
              )}
              <SignaturePreview
                data={selected.signatureData}
                label={selected.kindLabel}
                text={resolvePledgeText(selected.kind, selected.pledgeTextHash)}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
