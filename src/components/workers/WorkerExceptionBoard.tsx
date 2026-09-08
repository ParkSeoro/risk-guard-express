import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useActiveProject } from "@/hooks/useActiveProject";
import { todaySeoulDate } from "@/lib/dailyWorkAck";
import { fetchAttendanceExceptions, type AttendanceExceptions, type ExceptionItem } from "@/lib/laborEvidence";

type SectionKey = keyof Omit<AttendanceExceptions, "date">;

const SECTIONS: Array<{ key: SectionKey; title: string; hint: string }> = [
  { key: "missingAttendance", title: "미출역", hint: "활성 명부인데 당일 입장이 없습니다. 출입정지자는 제외합니다." },
  { key: "missingExit", title: "미퇴근", hint: "입장 후 퇴근이 없는 기록입니다. 추정 마감하지 않고 정정으로 처리하세요." },
  { key: "missingDailyAck", title: "일일서약 없음", hint: "입장했는데 당일 작업/위험 서약이 없습니다." },
  { key: "missingTbm", title: "TBM 미참석", hint: "당일 TBM 세션이 있는데 참여 기록이 없습니다." },
  { key: "duplicateEntry", title: "중복 입장", hint: "같은 날 입장 로그가 2건 이상입니다." },
  { key: "overdueRequired", title: "교육·건진 기한초과", hint: "법정 의무사항이 기한을 넘겼습니다." },
  { key: "missingHealthLog", title: "건강일지 미작성", hint: "일일 건강일지 대상이 출근했는데 기록이 없습니다." },
  { key: "gpsBlocked", title: "GPS 차단", hint: "위치 동의·권한·펜스 문제로 추적이 꺼진 상태입니다." },
  { key: "permitNoShow", title: "허가서 배정 미출역", hint: "당일 허가서 투입인데 입장이 없습니다." },
  { key: "ppePending", title: "보호구 미수령 출근", hint: "출근했는데 보호구 수령 서명이 남아 있습니다." },
];

export default function WorkerExceptionBoard() {
  const { projectId } = useActiveProject();
  const [date, setDate] = useState(() => todaySeoulDate());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AttendanceExceptions | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    fetchAttendanceExceptions(projectId, date)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => toast.error(e.message || "예외 목록 로드 실패"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, date]);

  const total = SECTIONS.reduce((s, sec) => s + ((data?.[sec.key] as ExceptionItem[] | undefined)?.length || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" /> 예외·미완료
          </h2>
          <p className="text-xs text-muted-foreground mt-1">미출역·미서명·미퇴근을 한 화면에서 봅니다. 퇴근 시각은 추정으로 넣지 않습니다.</p>
        </div>
        <div>
          <Label>날짜</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {loading && <Skeleton className="h-24 w-full" />}
      {!loading && (
        <p className="text-sm text-muted-foreground">
          {date} 예외 {total}건
          <Link className="ml-3 underline-offset-2 hover:underline" to="/app/admin/admin/tracking-health">
            GPS 추적 상태
          </Link>
          <Link className="ml-3 underline-offset-2 hover:underline" to="/app/admin/zone-events">
            구역 이벤트
          </Link>
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-3">
        {SECTIONS.map((sec) => {
          const items = (data?.[sec.key] as ExceptionItem[] | undefined) || [];
          return (
            <Card key={sec.key} className={items.length ? "border-destructive/30" : undefined}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{sec.title}</span>
                  <span className={items.length ? "text-destructive" : "text-muted-foreground"}>{items.length}</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{sec.hint}</p>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">없음</p>
                ) : (
                  <ul className="text-sm space-y-1 max-h-56 overflow-y-auto">
                    {items.slice(0, 40).map((it, i) => (
                      <li key={`${sec.key}-${it.workerId || i}-${it.entryLogId || it.workPermitId || i}`} className="flex justify-between gap-2 border-b py-1">
                        <span>
                          {it.workerId ? (
                            <Link className="hover:underline" to={`/app/admin/workers/${it.workerId}`}>
                              {it.workerName || "—"}
                            </Link>
                          ) : (
                            it.workerName || "—"
                          )}
                          <span className="text-xs text-muted-foreground ml-1">
                            {it.companyName || ""}
                            {it.jobType ? ` · ${it.jobType}` : ""}
                            {it.workName ? ` · ${it.workName}` : ""}
                            {it.itemName ? ` · ${it.itemName}` : ""}
                            {it.subtype ? ` · ${it.subtype}` : ""}
                            {it.blockReason ? ` · ${it.blockReason}` : ""}
                            {it.count ? ` · ${it.count}건` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                    {items.length > 40 && <li className="text-xs text-muted-foreground">외 {items.length - 40}명</li>}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
