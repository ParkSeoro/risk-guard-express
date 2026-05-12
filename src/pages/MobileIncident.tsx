import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import IMESafeInput from "@/components/IMESafeInput";
import IMESafeTextarea from "@/components/IMESafeTextarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Camera, Loader2, AlertOctagon, MapPin } from "lucide-react";
import { toast } from "sonner";
import { correctTerms } from "@/lib/termCorrection";

const TYPES = [
  { v: "near_miss", label: "아차사고" },
  { v: "minor", label: "경미사고" },
  { v: "major", label: "중대사고" },
  { v: "property", label: "재산피해" },
];
const SEVERITY = [
  { v: "low", label: "낮음" },
  { v: "medium", label: "보통" },
  { v: "high", label: "높음" },
];

export default function MobileIncident() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { projectId, applyCompanyFilter } = useMobileAccess();
  const { log: logAudit } = useAuditLog();
  const [type, setType] = useState("near_miss");
  const [severity, setSeverity] = useState("medium");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);

  const loadRecent = async () => {
    if (!projectId) return;
    let q: any = supabase.from("incident_reports" as any)
      .select("id, incident_type, severity, location, occurred_at, status")
      .eq("project_id", projectId).eq("is_deleted", false);
    q = applyCompanyFilter(q);
    const { data, error } = await q.order("occurred_at", { ascending: false }).limit(5);
    if (error) toast.error("최근 신고 로드 실패: " + error.message);
    setRecent((data as any) || []);
  };
  useEffect(() => { loadRecent(); /* eslint-disable-next-line */ }, [projectId]);

  const grabGps = () => {
    if (!navigator.geolocation) return toast.error("GPS 미지원");
    navigator.geolocation.getCurrentPosition(
      pos => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }); toast.success("위치 기록됨"); },
      () => toast.error("위치 권한이 거부됨"),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const onPick = (files: FileList | null) => {
    if (!files) return;
    setPhotos(prev => [...prev, ...Array.from(files)].slice(0, 5));
  };

  const upload = async (f: File) => {
    const ext = f.name.split(".").pop() || "jpg";
    const path = `${projectId}/incidents/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("attachments").upload(path, f);
    if (error) throw error;
    return supabase.storage.from("attachments").getPublicUrl(path).data.publicUrl;
  };

  const submit = async () => {
    if (!projectId) return toast.error("프로젝트를 먼저 선택하세요");
    if (!location.trim()) return toast.error("위치를 입력하세요");
    if (!description.trim()) return toast.error("내용을 입력하세요");
    setSubmitting(true);
    try {
      const urls: string[] = [];
      for (const f of photos) urls.push(await upload(f));
      const payload = {
        project_id: projectId,
        reporter_id: profile?.user_id,
        reporter_name: profile?.display_name || "",
        incident_type: type,
        severity,
        location: correctTerms(location),
        description: correctTerms(description),
        photos: urls,
        gps_lat: gps?.lat,
        gps_lng: gps?.lng,
      };
      const { data, error } = await supabase.from("incident_reports" as any).insert(payload).select().single();
      if (error) throw error;
      await logAudit('create', 'incident_report', (data as any).id, projectId, { type, severity, location: payload.location });

      // 관리자 알림
      try {
        const { data: members } = await supabase.from("project_members")
          .select("user_id, role").eq("project_id", projectId)
          .in("role", ["master", "project_admin", "safety_manager"]);
        const { sendNotification } = await import("@/lib/notificationService");
        await Promise.all(((members as any) || []).map((m: any) =>
          sendNotification({
            user_id: m.user_id,
            title: severity === "high" ? "🚨 중대 사고 신고" : "사고 신고 접수",
            message: `${TYPES.find(x => x.v === type)?.label} · ${payload.location}`,
            type: "incident_report",
            related_id: (data as any).id,
            related_type: "incident_report",
            project_id: projectId,
          })
        ));
      } catch {}

      toast.success("신고 접수 완료");
      setLocation(""); setDescription(""); setPhotos([]); setGps(null);
      loadRecent();
    } catch (e: any) {
      toast.error("신고 실패: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-destructive text-destructive-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-destructive-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <AlertOctagon className="h-5 w-5" />
        <div className="font-bold text-lg">사고/아차사고 신고</div>
      </header>

      <main className="p-4 space-y-4 max-w-md mx-auto">
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요. <Button variant="link" size="sm" onClick={() => navigate("/m")}>홈으로</Button></CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div>
              <Label className="text-base">사고 유형 *</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {TYPES.map(t => (
                  <Button key={t.v} type="button" variant={type === t.v ? "default" : "outline"}
                    className="h-12" onClick={() => setType(t.v)}>{t.label}</Button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-base">심각도 *</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {SEVERITY.map(s => (
                  <Button key={s.v} type="button"
                    variant={severity === s.v ? (s.v === "high" ? "destructive" : "default") : "outline"}
                    className="h-12" onClick={() => setSeverity(s.v)}>{s.label}</Button>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-base">발생 위치 *</Label>
              <IMESafeInput className="h-12 text-base" defaultValue={location}
                onCommit={setLocation} placeholder="예: B동 2층 계단" />
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={grabGps}>
                <MapPin className="h-4 w-4 mr-1" /> {gps ? `위치 기록됨 (${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)})` : "현재 GPS 좌표 추가"}
              </Button>
            </div>

            <div>
              <Label className="text-base">상황 설명 *</Label>
              <IMESafeTextarea rows={4} defaultValue={description}
                onCommit={setDescription} placeholder="언제·어떻게·결과" />
            </div>

            <div>
              <Label className="text-base">사진 ({photos.length}/5)</Label>
              <label className="block">
                <div className="border-2 border-dashed rounded-lg p-5 text-center active:bg-muted">
                  <Camera className="h-7 w-7 mx-auto text-muted-foreground" />
                  <div className="text-sm mt-1">사진 촬영/선택</div>
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

            <Button className="w-full h-14 text-base" variant="destructive" onClick={submit} disabled={submitting || !projectId}>
              {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />} 신고 접수
            </Button>
          </CardContent>
        </Card>

        {recent.length > 0 && (
          <Card>
            <CardContent className="pt-4">
              <div className="font-semibold text-sm mb-2">최근 신고 ({recent.length})</div>
              <div className="space-y-1 text-xs">
                {recent.map(r => (
                  <div key={r.id} className="flex justify-between border-b py-1.5">
                    <div>{TYPES.find(t => t.v === r.incident_type)?.label} · {r.location}</div>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
