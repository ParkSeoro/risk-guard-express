import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { ArrowLeft, Camera, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { correctTerms } from "@/lib/termCorrection";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";
import { INSPECTION_ACTION_DONE_STATUS } from "@/lib/inspectionActions";

type ActionRow = {
  id: string;
  inspection_id: string;
  project_id: string;
  issue: string;
  severity: string;
  status: string;
  due_date: string | null;
  evidence_photos: any;
  created_at: string;
};

const sevColor: Record<string, string> = {
  high: "bg-destructive text-destructive-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-muted text-muted-foreground",
};
const sevLabel: Record<string, string> = { high: "높음", medium: "보통", low: "낮음" };

export default function MobileActions() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { profile } = useAuth();
  const { projectId } = useMobileAccess();
  const { log: logAudit } = useAuditLog();
  const [tab, setTab] = useState<"pending" | "completed">("pending");
  const [rows, setRows] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let q: any = supabase.from("safety_inspection_actions" as any).select("*").eq("project_id", projectId);
    // safety_inspection_actions has no company_id — do not applyCompanyFilter
    const { data, error } = await q.in("status", tab === "pending" ? ["pending", "in_progress"] : ["done", "completed"])
      .order("created_at", { ascending: false }).limit(50);
    if (error) toast.error(error.message);
    setRows(((data as any) || []) as ActionRow[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab, projectId]);

  const complete = async (row: ActionRow) => {
    if (!note.trim()) return toast.error("조치 내용을 입력하세요");
    setSubmitting(true);
    try {
      const photos: string[] = Array.isArray(row.evidence_photos) ? [...row.evidence_photos] : [];
      if (photo) {
        const ext = photo.name.split(".").pop() || "jpg";
        const path = `${projectId}/inspection-actions/${Date.now()}.${ext}`;
        const uploaded = await uploadAttachmentFile(path, photo);
        photos.push(uploaded.publicUrl);
      }
      const cleanNote = correctTerms(note);
      const { error } = await supabase.from("safety_inspection_actions" as any)
        .update({
          status: INSPECTION_ACTION_DONE_STATUS,
          completion_note: cleanNote,
          completed_at: new Date().toISOString(),
          completed_by: profile?.user_id,
          evidence_photos: photos,
        }).eq("id", row.id);
      if (error) throw error;
      await logAudit('complete', 'safety_inspection_action', row.id, projectId, { note: cleanNote });
      toast.success("조치 완료 처리됨");
      setOpenId(null); setNote(""); setPhoto(null);
      load();
    } catch (e: any) {
      toast.error("실패: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => goMobileHome()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">조치 관리</div>
      </header>

      <div className="grid grid-cols-2 sticky top-16 bg-background border-b z-10">
        <button onClick={() => setTab("pending")}
          className={`py-3 text-sm font-medium ${tab === "pending" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
          진행중
        </button>
        <button onClick={() => setTab("completed")}
          className={`py-3 text-sm font-medium ${tab === "completed" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
          완료
        </button>
      </div>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요.</CardContent>
          </Card>
        )}
        {loading && <div className="text-center text-muted-foreground py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></div>}
        {!loading && projectId && rows.length === 0 && <div className="text-center text-muted-foreground py-8 text-sm">조치 항목이 없습니다</div>}
        {rows.map(r => (
          <Card key={r.id}>
            <CardContent className="pt-4 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className={sevColor[r.severity] || ""}>{sevLabel[r.severity] || r.severity}</Badge>
                {r.due_date && <Badge variant="outline" className="text-xs">기한 {r.due_date}</Badge>}
                {r.status === "done" || r.status === "completed" ? <Badge variant="secondary" className="text-xs"><CheckCircle2 className="h-3 w-3 mr-1" />완료</Badge> : null}
              </div>
              <div className="text-sm font-medium leading-snug">{r.issue}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString("ko-KR")}
              </div>

              {tab === "pending" && (
                openId === r.id ? (
                  <div className="space-y-2 pt-2 border-t">
                    <IMESafeTextarea rows={2} placeholder="조치 내용" defaultValue={note} onCommit={setNote} />
                    <label className="block">
                      <div className="border-2 border-dashed rounded p-3 text-center text-sm cursor-pointer">
                        <Camera className="h-5 w-5 inline mr-1" />
                        {photo ? photo.name : "조치 사진 추가"}
                      </div>
                      <input type="file" accept="image/*" capture="environment" className="hidden"
                        onChange={e => setPhoto(e.target.files?.[0] || null)} />
                    </label>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={() => { setOpenId(null); setNote(""); setPhoto(null); }}>취소</Button>
                      <Button className="flex-1" onClick={() => complete(r)} disabled={submitting}>
                        {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} 완료 처리
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" className="w-full mt-2" onClick={() => setOpenId(r.id)}>
                    <CheckCircle2 className="h-4 w-4 mr-1" /> 조치하기
                  </Button>
                )
              )}

              {tab === "completed" && Array.isArray(r.evidence_photos) && r.evidence_photos.length > 0 && (
                <div className="grid grid-cols-3 gap-1 pt-2">
                  {r.evidence_photos.slice(0, 3).map((u: string, i: number) => (
                    <img key={i} src={u} className="aspect-square w-full object-cover rounded" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
