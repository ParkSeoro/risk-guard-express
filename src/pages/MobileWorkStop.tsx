import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { OctagonAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { lookupWorkerBanFields } from "@/lib/tracking/resolveBanSubject";
import {
  ANONYMOUS_REPORTER_LABEL,
  WORK_STOP_LEGAL_CITE,
  WORK_STOP_OPEN_STATUSES,
  buildWorkStopInsert,
  validateWorkStopForm,
  workStopDisplayName,
  type WorkStopIdentityMode,
} from "@/lib/workStop";

export default function MobileWorkStop() {
  const { user, profile } = useAuth();
  const { projectId, role, isMaster } = useMobileAccess();
  const blockWrite = usePreviewWriteBlock();
  const manager = isManagerMobileRole(role, isMaster);

  const [identity, setIdentity] = useState<WorkStopIdentityMode>("named");
  const [form, setForm] = useState({
    reporter_name: profile?.display_name || "",
    location: "",
    hazard_description: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [openStops, setOpenStops] = useState<
    { id: string; reporter_name: string; is_anonymous?: boolean; location: string | null; hazard_description: string; status: string }[]
  >([]);
  const [loadingStops, setLoadingStops] = useState(false);

  useEffect(() => {
    if (profile?.display_name) {
      setForm((f) => ({ ...f, reporter_name: f.reporter_name || profile.display_name || "" }));
    }
  }, [profile?.display_name]);

  useEffect(() => {
    if (!manager || !projectId) return;
    let cancelled = false;
    (async () => {
      setLoadingStops(true);
      const { data } = await supabase
        .from("work_stop_requests")
        .select("id, reporter_name, is_anonymous, location, hazard_description, status, created_at")
        .eq("project_id", projectId)
        .in("status", [...WORK_STOP_OPEN_STATUSES])
        .order("created_at", { ascending: false })
        .limit(20);
      if (!cancelled) {
        setOpenStops((data as typeof openStops) || []);
        setLoadingStops(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [manager, projectId, submitted]);

  async function submit() {
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    const isAnonymous = identity === "anonymous";
    const err = validateWorkStopForm({
      projectId,
      isAnonymous,
      reporterName: form.reporter_name,
      hazardDescription: form.hazard_description,
    });
    if (err) {
      toast.error(err);
      return;
    }
    setSubmitting(true);
    const matched = await lookupWorkerBanFields(projectId!, profile?.phone);
    const payload = buildWorkStopInsert({
      projectId: projectId!,
      workerId: matched.worker_id,
      reporterUserId: user?.id || null,
      reporterName: form.reporter_name,
      location: form.location,
      hazardDescription: form.hazard_description,
      isAnonymous,
    });
    const { error } = await supabase.from("work_stop_requests").insert(payload);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      isAnonymous
        ? "익명으로 작업중지 요청이 전달되었습니다"
        : "작업중지 요청이 즉시 관리자에게 전달되었습니다",
    );
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="p-4 flex items-center justify-center">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-3">
            <OctagonAlert className="size-12 text-destructive mx-auto" />
            <h2 className="text-lg font-bold">작업중지 요청 전송됨</h2>
            <p className="text-sm text-muted-foreground">
              {identity === "anonymous"
                ? "신고자 이름은 익명으로 전달되었습니다."
                : "실명으로 전달되었습니다."}
              <br />
              관리자·소속 회사·발주처에 즉시 알립니다.
              <br />
              법적으로 보호되며, 어떠한 불이익도 받지 않습니다 ({WORK_STOP_LEGAL_CITE}).
            </p>
            <Button
              onClick={() => {
                setSubmitted(false);
                setForm((f) => ({ ...f, location: "", hazard_description: "" }));
              }}
            >
              새 요청
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-md mx-auto" data-testid="mobile-work-stop">
      <header className="text-center pt-2">
        <OctagonAlert className="size-12 text-destructive mx-auto" />
        <h1 className="text-xl font-bold mt-2">작업중지권 행사</h1>
        <p className="text-xs text-muted-foreground mt-1">
          {WORK_STOP_LEGAL_CITE} — 위험상황 발견 즉시 작업을 중지하고 보고하세요
        </p>
      </header>

      {manager && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="text-sm font-medium flex items-center justify-between">
              처리 중 요청
              {loadingStops && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            </div>
            {!loadingStops && openStops.length === 0 && (
              <p className="text-xs text-muted-foreground">열린 작업중지가 없습니다.</p>
            )}
            {openStops.map((s) => (
              <div key={s.id} className="rounded-lg border p-2 text-xs space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">{s.status}</Badge>
                  <span className="font-medium">{workStopDisplayName(s)}</span>
                </div>
                <div className="text-muted-foreground">{s.location || "위치 미기재"}</div>
                <div className="line-clamp-2">{s.hazard_description}</div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">
              상세 조치·재개 승인은 PC 관리 화면에서 처리하세요.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label>신고 방식 *</Label>
            <div className="grid grid-cols-2 gap-2 mt-1.5" data-testid="work-stop-identity">
              <Button
                type="button"
                variant={identity === "anonymous" ? "default" : "outline"}
                className="h-11"
                onClick={() => setIdentity("anonymous")}
              >
                익명
              </Button>
              <Button
                type="button"
                variant={identity === "named" ? "default" : "outline"}
                className="h-11"
                onClick={() => setIdentity("named")}
              >
                실명
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
              {identity === "anonymous"
                ? `관리자·알림에는 「${ANONYMOUS_REPORTER_LABEL}」로만 표시됩니다.`
                : "이름과 함께 소속 회사·발주처 관리자에게 전달됩니다."}
            </p>
          </div>
          {identity === "named" && (
            <div>
              <Label>보고자명 *</Label>
              <Input
                value={form.reporter_name}
                onChange={(e) => setForm({ ...form, reporter_name: e.target.value })}
              />
            </div>
          )}
          <div>
            <Label>위치</Label>
            <Input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="예: 3층 동측 비계"
            />
          </div>
          <div>
            <Label>위험상황 설명 *</Label>
            <Textarea
              rows={5}
              value={form.hazard_description}
              onChange={(e) => setForm({ ...form, hazard_description: e.target.value })}
              placeholder="어떤 급박한 위험이 있는지 구체적으로 작성하세요"
            />
          </div>
          <Button
            onClick={submit}
            disabled={submitting}
            className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground"
          >
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            작업중지 요청
          </Button>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground p-1">
        사업주는 작업중지권 행사 근로자에게 해고·전보·임금삭감 등 어떠한 불리한 처우도 할 수
        없습니다 ({WORK_STOP_LEGAL_CITE}).
      </div>
    </div>
  );
}
