import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useWorker, calcAge, JOB_TYPE_LABELS, REQ_TYPE_LABELS } from "@/hooks/useWorker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, HardHat, AlertTriangle, Heart, GraduationCap, Calendar, ScrollText, FlaskConical } from "lucide-react";

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
  const { data, isLoading } = useWorker(id);

  const age = useMemo(() => calcAge(data?.worker?.birth_date), [data]);
  const w = data?.worker;

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
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList className="grid grid-cols-5 w-full">
          <TabsTrigger value="overview"><ScrollText className="h-4 w-4 mr-1" />개요</TabsTrigger>
          <TabsTrigger value="education"><GraduationCap className="h-4 w-4 mr-1" />법정교육</TabsTrigger>
          <TabsTrigger value="health"><Heart className="h-4 w-4 mr-1" />건강관리</TabsTrigger>
          <TabsTrigger value="daily" disabled={!w.requires_daily_health_log}>일일일지</TabsTrigger>
          <TabsTrigger value="attendance"><Calendar className="h-4 w-4 mr-1" />출퇴근</TabsTrigger>
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
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">법정 교육 현황</CardTitle>
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
              <Link to={`/m/daily-health-log?worker=${w.id}`}><Button size="sm">오늘 일지 작성</Button></Link>
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
            <CardHeader><CardTitle className="text-base">최근 출퇴근 (30건)</CardTitle></CardHeader>
            <CardContent>
              {data!.recentEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">출퇴근 기록이 없습니다.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr><th className="py-2">입장</th><th>퇴장</th><th>무사고</th></tr>
                  </thead>
                  <tbody>
                    {data!.recentEntries.map((e: any) => (
                      <tr key={e.id} className="border-t">
                        <td className="py-2">{e.entry_at ? new Date(e.entry_at).toLocaleString("ko-KR") : "-"}</td>
                        <td>{e.exit_at ? new Date(e.exit_at).toLocaleString("ko-KR") : "근무중"}</td>
                        <td>{e.no_accident_confirmed ? "✓" : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
