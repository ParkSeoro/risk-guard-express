import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Camera, CheckCircle2, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { enqueue, isOnline } from "@/lib/offlineQueue";

// 모바일 안전점검: 위치 + 사진 + 합/불 빠른 등록
export default function MobileInspect() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const projectId = typeof window !== "undefined" ? localStorage.getItem("selectedProjectId") || "" : "";
  const [location, setLocation] = useState("");
  const [issue, setIssue] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [result, setResult] = useState<"pass" | "fail" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onPick = (files: FileList | null) => {
    if (!files) return;
    setPhotos(prev => [...prev, ...Array.from(files)].slice(0, 5));
  };

  const upload = async (f: File) => {
    const ext = f.name.split(".").pop() || "jpg";
    const path = `${projectId}/mobile-inspect/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("attachments").upload(path, f);
    if (error) throw error;
    return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
  };

  const submit = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    if (!location.trim()) return toast.error("점검 위치를 입력하세요");
    if (!result) return toast.error("합격/불합격을 선택하세요");
    if (result === "fail" && photos.length === 0) return toast.error("불합격 시 사진은 필수입니다");

    setSubmitting(true);

    // 오프라인이면 큐에 저장
    if (!isOnline()) {
      const photoData = await Promise.all(photos.map(f => new Promise<{ name: string; data: string }>((res) => {
        const r = new FileReader(); r.onload = () => res({ name: f.name, data: r.result as string }); r.readAsDataURL(f);
      })));
      await enqueue({ kind: "inspection_item", payload: { projectId, location, issue, result, photos: photoData, inspector: profile?.display_name } });
      setSubmitting(false);
      toast.success("오프라인 저장됨. 온라인 복귀 시 동기화됩니다");
      navigate("/m");
      return;
    }

    try {
      const urls: string[] = [];
      for (const f of photos) urls.push(await upload(f));

      const { data: ins, error } = await supabase.from("safety_inspections" as any).insert({
        project_id: projectId,
        inspection_type: "patrol",
        process_category: "기타",
        location,
        summary: issue,
        inspector_name: profile?.display_name || "",
        inspector_id: profile?.user_id,
        created_by: profile?.user_id,
        status: result === "fail" ? "in_progress" : "completed",
      }).select().single();
      if (error) throw error;

      const { data: item } = await supabase.from("safety_inspection_items" as any).insert({
        inspection_id: (ins as any).id,
        checklist_code: "MOBILE",
        label: issue || "현장 점검",
        legal_basis: "",
        result,
        note: "",
        photos: urls,
        sort_order: 0,
      }).select().single();

      if (result === "fail") {
        const { data: action } = await supabase.from("safety_inspection_actions" as any).insert({
          inspection_id: (ins as any).id,
          item_id: (item as any)?.id,
          project_id: projectId,
          issue: issue || location,
          severity: "medium",
          status: "pending",
        }).select().single();

        // 알림: 프로젝트 안전관리자/관리자
        try {
          const { data: members } = await supabase.from("project_members")
            .select("user_id, role").eq("project_id", projectId)
            .in("role", ["master", "project_admin", "safety_manager"]);
          const { sendNotification } = await import("@/lib/notificationService");
          await Promise.all(((members as any) || []).map((m: any) =>
            sendNotification({
              user_id: m.user_id,
              title: "안전점검 불합격",
              message: `${location} · ${issue || "현장 점검"}`,
              type: "inspection_fail",
              related_id: (ins as any).id,
              related_type: "safety_inspection",
              project_id: projectId,
            })
          ));
        } catch {}
      }

      toast.success(result === "fail" ? "불합격 등록 + 조치 요청 생성" : "점검 완료");
      navigate("/m");
    } catch (e: any) {
      toast.error("등록 실패: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg">현장 안전점검</div>
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label className="text-base">점검 위치 *</Label>
              <Input className="h-12 text-base" value={location} onChange={e => setLocation(e.target.value)} placeholder="예: 3층 동측 굴착부" />
            </div>
            <div>
              <Label className="text-base">문제 내용</Label>
              <Textarea value={issue} onChange={e => setIssue(e.target.value)} placeholder="발견 사항 또는 점검 항목" rows={3} />
            </div>

            <div>
              <Label className="text-base">사진 ({photos.length}/5)</Label>
              <label className="block">
                <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer active:bg-muted">
                  <Camera className="h-8 w-8 mx-auto text-muted-foreground" />
                  <div className="text-sm mt-2">사진 촬영/선택</div>
                </div>
                <input type="file" accept="image/*" capture="environment" multiple className="hidden"
                  onChange={e => onPick(e.target.files)} />
              </label>
              {photos.length > 0 && (
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {photos.map((f, i) => (
                    <div key={i} className="relative aspect-square">
                      <img src={URL.createObjectURL(f)} className="w-full h-full object-cover rounded" />
                      <button onClick={() => setPhotos(p => p.filter((_, j) => j !== i))}
                        className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full h-5 w-5 text-xs">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <Button size="lg" variant={result === "pass" ? "default" : "outline"}
                className={`h-16 text-lg ${result === "pass" ? "bg-success hover:bg-success" : ""}`}
                onClick={() => setResult("pass")}>
                <CheckCircle2 className="h-6 w-6 mr-2" /> 합격
              </Button>
              <Button size="lg" variant={result === "fail" ? "destructive" : "outline"}
                className="h-16 text-lg" onClick={() => setResult("fail")}>
                <XCircle className="h-6 w-6 mr-2" /> 불합격
              </Button>
            </div>

            {result === "fail" && (
              <div className="flex gap-2 text-xs bg-destructive/10 border border-destructive/30 rounded p-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <span>불합격 등록 시 자동으로 조치 요청이 생성되고 담당자에게 알림이 발송됩니다.</span>
              </div>
            )}

            <Button className="w-full h-14 text-lg" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />} 등록
            </Button>
            {!isOnline() && <Badge variant="destructive" className="w-full justify-center">오프라인 — 자동 저장 후 동기화</Badge>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
