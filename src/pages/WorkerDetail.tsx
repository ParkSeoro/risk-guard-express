import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useWorker, calcAge, JOB_TYPE_LABELS, REQ_TYPE_LABELS } from "@/hooks/useWorker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, HardHat, AlertTriangle, Heart, GraduationCap, Calendar, ScrollText, PenLine } from "lucide-react";
import RequiredEducationPanel from "@/components/worker/RequiredEducationPanel";
import JobTypeSelect from "@/components/JobTypeSelect";
import WorkerSignatureLedgerPanel from "@/components/workers/WorkerSignatureLedgerPanel";
import { todaySeoulDate } from "@/lib/dailyWorkAck";
import { addSeoulDays, buildWorkHourRow, formatWorkHours, seoulWeekStart, summarizeHours, week52Status } from "@/lib/workHours";
import { fetchWorkHourRows, hoursDisclaimer, syncWorkerProfileIdentity } from "@/lib/laborEvidence";
import type { WorkHourRow } from "@/lib/workHours";
import { toast } from "sonner";
import type { StandardJobType } from "@/lib/jobCategories";

const statusBadge = (status: string, due?: string) => {
  if (status === "done") return <Badge variant="outline" className="bg-success/10 text-success border-success/40">완료</Badge>;
  if (status === "overdue") return <Badge variant="destructive">기한초과</Badge>;
  if (due) {
    const days = Math.ceil((new Date(due).getTime() - Date.now()) / 86400000);
    if (days <= 7) return <Badge className="bg-warning text-warning-foreground">D-{Math.max(days, 0)}</Badge>;
  }
  return <Badge variant="secondary">대기</Badge>;
};

export default function WorkerDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useWorker(id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    jobType: "",
    birthDate: "",
    hireDate: "",
    emergencyName: "",
    emergencyPhone: "",
  });
  const [hoursFrom, setHoursFrom] = useState(() => addSeoulDays(todaySeoulDate(), -30));
  const [hoursTo, setHoursTo] = useState(() => todaySeoulDate());
  const [periodRows, setPeriodRows] = useState<WorkHourRow[] | null>(null);

  const age = useMemo(() => calcAge(data?.worker?.birth_date), [data]);
  const w = data?.worker;

  useEffect(() => {
    if (!w) return;
    setForm({
      name: w.name || "",
      phone: w.phone || "",
      jobType: w.job_type || "",
      birthDate: w.birth_date || "",
      hireDate: w.hire_date || "",
      emergencyName: w.emergency_name || "",
      emergencyPhone: w.emergency_phone || "",
    });
  }, [w]);

  useEffect(() => {
    if (!w?.project_id || !id) return;
    let cancelled = false;
    fetchWorkHourRows({ projectId: w.project_id, from: hoursFrom, to: hoursTo })
      .then((rows) => {
        if (!cancelled) setPeriodRows(rows.filter((r) => r.workerId === id));
      })
      .catch(() => {
        if (!cancelled) setPeriodRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [w?.project_id, id, hoursFrom, hoursTo]);

  const hourRows = useMemo(() => {
    if (periodRows) return periodRows;
    return (data?.recentEntries || [])
      .map((e: any) =>
        buildWorkHourRow({
          entryLogId: e.id,
          workerId: e.worker_id || id || "",
          entryAt: e.entry_at,
          exitAt: e.exit_at,
          jobType: w?.job_type,
          companyName: w?.company_name,
        }),
      )
      .filter((r) => r.workDate >= hoursFrom && r.workDate <= hoursTo);
  }, [periodRows, data, hoursFrom, hoursTo, id, w]);

  const hourSummary = useMemo(() => summarizeHours(hourRows), [hourRows]);
  const weekMins = useMemo(() => {
    const start = seoulWeekStart(todaySeoulDate());
    return hourRows.filter((r) => r.workDate >= start && r.minutes != null).reduce((s, r) => s + (r.minutes || 0), 0);
  }, [hourRows]);

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">로딩 중...</div>;
  if (!w) return <div className="p-8 text-center">근로자 정보를 찾을 수 없습니다.</div>;

  const pending = (data?.requiredItems || []).filter((r) => r.status !== "done");
  const overdue = pending.filter((r) => r.status === "overdue");

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <HardHat className="h-6 w-6" /> {w.name}
          {age !== null && <span className="text-base text-muted-foreground">({age}세)</span>}
          {w.requires_daily_health_log && <Badge className="bg-warning text-warning-foreground ml-2">일일 건강일지 대상</Badge>}
        </h1>
      </div>

      {/* 경고 배지 */}
      {(data!.warnings.length > 0 || overdue.length > 0) && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="pt-6 flex flex-wrap gap-2">
            {data!.warnings.map((w: any, i: number) => (
              <Badge key={i} variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />{w.message}</Badge>
            ))}
            {overdue.length > 0 && (
              <Badge variant="destructive">의무사항 {overdue.length}건 기한초과</Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* 기본정보 */}
      <Card>
        <CardHeader><CardTitle className="text-base">기본정보</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-muted-foreground">소속</div><div className="font-medium">{w.company_name || "-"}</div></div>
          <div><div className="text-xs text-muted-foreground">직종</div><div className="font-medium">{JOB_TYPE_LABELS[w.job_type] || w.job_type || "일반작업"}</div></div>
          <div><div className="text-xs text-muted-foreground">입사일</div><div className="font-medium">{w.hire_date || "-"}</div></div>
          <div><div className="text-xs text-muted-foreground">생년월일</div><div className="font-medium">{w.birth_date || "-"}</div></div>
          <div><div className="text-xs text-muted-foreground">연락처</div><div className="font-medium">{w.phone}</div></div>
          <div><div className="text-xs text-muted-foreground">건강등급</div><div className="font-medium">{w.health_grade || w.health_checkup_status || "-"}</div></div>
          <div><div className="text-xs text-muted-foreground">옥외작업자</div><div className="font-medium">{w.outdoor_worker ? "예" : "아니오"}</div></div>
          <div><div className="text-xs text-muted-foreground">교육 확인</div><div className="font-medium">{w.education_confirmed_at ? "확인됨" : "미확인"}</div></div>
          <div><div className="text-xs text-muted-foreground">비상연락</div><div className="font-medium">{w.emergency_name || "-"} {w.emergency_phone || ""}</div></div>
        </CardContent>
        <CardContent className="pt-0">
          {editing ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm border-t pt-3">
              <div>
                <Label>이름</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>전화</Label>
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>직종</Label>
                <JobTypeSelect value={form.jobType} onValueChange={(v: StandardJobType) => setForm((f) => ({ ...f, jobType: v }))} />
              </div>
              <div>
                <Label>생년월일</Label>
                <Input type="date" value={form.birthDate} onChange={(e) => setForm((f) => ({ ...f, birthDate: e.target.value }))} />
              </div>
              <div>
                <Label>입사일</Label>
                <Input type="date" value={form.hireDate} onChange={(e) => setForm((f) => ({ ...f, hireDate: e.target.value }))} />
              </div>
              <div>
                <Label>비상 연락처 이름</Label>
                <Input value={form.emergencyName} onChange={(e) => setForm((f) => ({ ...f, emergencyName: e.target.value }))} />
              </div>
              <div>
                <Label>비상 연락처 전화</Label>
                <Input value={form.emergencyPhone} onChange={(e) => setForm((f) => ({ ...f, emergencyPhone: e.target.value }))} />
              </div>
              <div className="col-span-2 flex gap-2 items-end">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    const res = await syncWorkerProfileIdentity({
                      workerId: w.id,
                      name: form.name,
                      phone: form.phone,
                      jobType: form.jobType,
                      birthDate: form.birthDate || null,
                      hireDate: form.hireDate || null,
                      emergencyName: form.emergencyName,
                      emergencyPhone: form.emergencyPhone,
                    });
                    setSaving(false);
                    if (!res.ok) {
                      toast.error(res.error || "저장 실패");
                      return;
                    }
                    toast.success("명부를 저장하고 계정 이름/전화와 맞췄습니다");
                    setEditing(false);
                    void qc.invalidateQueries({ queryKey: ["worker-detail", id] });
                  }}
                >
                  {saving ? "저장 중…" : "저장"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>취소</Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>명부 수정</Button>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="overview"><ScrollText className="h-4 w-4 mr-1" />개요</TabsTrigger>
          <TabsTrigger value="education"><GraduationCap className="h-4 w-4 mr-1" />법정교육</TabsTrigger>
          <TabsTrigger value="health"><Heart className="h-4 w-4 mr-1" />건강관리</TabsTrigger>
          <TabsTrigger value="daily" disabled={!w.requires_daily_health_log}>일일일지</TabsTrigger>
          <TabsTrigger value="attendance"><Calendar className="h-4 w-4 mr-1" />출퇴근</TabsTrigger>
          <TabsTrigger value="signatures"><PenLine className="h-4 w-4 mr-1" />서명 이력</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-3 mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">다가오는 의무사항</CardTitle></CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">현재 처리할 의무사항이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2">구분</th><th>항목</th><th>마감일</th><th>상태</th></tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.id} className="border-t">
                        <td className="py-2">{r.item_type === "education" ? "교육" : r.item_type === "checkup" ? "건진" : "일일일지"}</td>
                        <td>{REQ_TYPE_LABELS[r.subtype] || r.subtype}</td>
                        <td>{r.due_date || "-"}</td>
                        <td>{statusBadge(r.status, r.due_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="education" className="mt-4 space-y-3">
          <RequiredEducationPanel mode="worker" workerId={id!} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">의무 일정(법정교육)</CardTitle>
              <Link to="/health/education"><Button size="sm" variant="outline">교육 등록</Button></Link>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2">교육 종류</th><th>법적 근거</th><th>마감일</th><th>상태</th></tr>
                </thead>
                <tbody>
                  {(data?.requiredItems || []).filter((r) => r.item_type === "education").map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2">{REQ_TYPE_LABELS[r.subtype] || r.subtype}</td>
                      <td className="text-xs text-muted-foreground">{r.legal_basis}</td>
                      <td>{r.due_date || "-"}</td>
                      <td>{statusBadge(r.status, r.due_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data!.educations.length > 0 && (
                <div className="mt-4">
                  <h4 className="font-medium text-sm mb-2">최근 이수 이력</h4>
                  <ul className="text-sm space-y-1">
                    {data!.educations.slice(0, 5).map((e: any) => (
                      <li key={e.id} className="border-b py-1 flex justify-between">
                        <span>{e.title || e.material_title || "교육"}</span>
                        <span className="text-muted-foreground">{e.conducted_at?.slice(0, 10)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">건강진단 이력</CardTitle>
              <Link to="/health/checkups"><Button size="sm" variant="outline">건진 등록</Button></Link>
            </CardHeader>
            <CardContent>
              {data!.checkups.length === 0 ? (
                <p className="text-sm text-muted-foreground">등록된 건강진단 이력이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2">시행일</th><th>구분</th><th>판정</th><th>기관</th><th>다음 예정</th></tr>
                  </thead>
                  <tbody>
                    {data!.checkups.map((c: any) => (
                      <tr key={c.id} className="border-t">
                        <td className="py-2">{c.conducted_date || "-"}</td>
                        <td>{c.type || "-"}</td>
                        <td>{c.result || "-"}</td>
                        <td>{c.institution || "-"}</td>
                        <td>{c.next_due_date || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="daily" className="mt-4 space-y-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">일일 건강일지 (최근 60일)</CardTitle>
              <Link to={`/app/worker/daily-health-log?worker=${w.id}`}><Button size="sm">오늘 일지 작성</Button></Link>
            </CardHeader>
            <CardContent>
              {data!.dailyLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">작성된 일지가 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2">날짜</th><th>체온</th><th>혈압</th><th>수면</th><th>작업 가능</th><th>증상</th></tr>
                  </thead>
                  <tbody>
                    {data!.dailyLogs.map((l: any) => (
                      <tr key={l.id} className="border-t">
                        <td className="py-2">{l.log_date}</td>
                        <td>{l.body_temp || "-"}°C</td>
                        <td>{l.bp_systolic ? `${l.bp_systolic}/${l.bp_diastolic}` : "-"}</td>
                        <td>{l.sleep_hours || "-"}h</td>
                        <td>{l.fit_to_work ? <Badge variant="outline" className="bg-success/10 text-success">가능</Badge> : <Badge variant="destructive">제한</Badge>}</td>
                        <td className="text-xs">{(l.symptoms || []).join(", ") || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attendance" className="mt-4 space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">출퇴근·근로시간</CardTitle>
              <p className="text-xs text-muted-foreground font-normal">{hoursDisclaimer()}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap items-end">
                <div>
                  <Label>시작</Label>
                  <Input type="date" value={hoursFrom} onChange={(e) => setHoursFrom(e.target.value)} />
                </div>
                <div>
                  <Label>종료</Label>
                  <Input type="date" value={hoursTo} onChange={(e) => setHoursTo(e.target.value)} />
                </div>
                <Badge variant={week52Status(weekMins) === "warn" ? "destructive" : "secondary"}>
                  이번 주 {formatWorkHours(weekMins)} {week52Status(weekMins) === "warn" ? "· 주52 초과" : week52Status(weekMins) === "caution" ? "· 주52 주의" : ""}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>합계 {formatWorkHours(hourSummary.minutes)}</div>
                <div>공수 {hourSummary.manDays.toFixed(2)}</div>
                <div>미퇴근 {hourSummary.incompleteCount}건</div>
              </div>
              {hourRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">선택한 기간의 출퇴근 기록이 없습니다. (최근 30건 범위)</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2">일자</th><th>입장</th><th>퇴장</th><th>시간</th><th>공수</th><th>무사고</th></tr>
                  </thead>
                  <tbody>
                    {hourRows.map((r) => {
                      const src = (data!.recentEntries as any[]).find((e) => e.id === r.entryLogId);
                      return (
                        <tr key={r.entryLogId} className="border-t">
                          <td className="py-2">{r.workDate}</td>
                          <td>{new Date(r.entryAt).toLocaleTimeString("ko-KR")}</td>
                          <td>{r.exitAt ? new Date(r.exitAt).toLocaleTimeString("ko-KR") : "근무중"}</td>
                          <td>{formatWorkHours(r.minutes)}</td>
                          <td>{r.manDays == null ? "—" : r.manDays.toFixed(2)}</td>
                          <td>{src?.no_accident_confirmed ? "✓" : "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="signatures" className="mt-4">
          {w.project_id && <WorkerSignatureLedgerPanel workerId={id} projectId={w.project_id} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
