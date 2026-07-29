import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AlertTriangle, CheckCircle2, ShieldAlert, Loader2 } from "lucide-react";
import IMESafeInput from "@/components/IMESafeInput";
import { koreanName, phoneKROptional, zodErrorMessage } from "@/lib/commonSchemas";
import { z } from "zod";

type Zone = { id: string; name: string; zone_type: "normal" | "work" | "restricted" | "danger"; project_id: string };
type Qr = { id: string; zone_id: string; project_id: string; direction: "entry" | "exit"; label: string | null; is_active: boolean };

const checkinSchema = z.object({ name: koreanName, phone: phoneKROptional });

// Public route — no auth required. Worker scans QR at site checkpoint.
export default function ZoneCheckin() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState<Qr | null>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [name, setName] = useState(() => localStorage.getItem("zone:lastName") || "");
  const [phone, setPhone] = useState(() => localStorage.getItem("zone:lastPhone") || "");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<"ok" | "warn" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    (async () => {
      const { data: qrRows } = await supabase.rpc("lookup_zone_qr_by_code", { _code: code });
      const q = Array.isArray(qrRows) ? qrRows[0] : (qrRows as any);
      if (!q) { setError("유효하지 않거나 비활성화된 QR입니다."); setLoading(false); return; }
      setQr(q as any);
      const { data: z } = await supabase
        .from("site_zones")
        .select("id,name,zone_type,project_id")
        .eq("id", (q as any).zone_id)
        .maybeSingle();
      setZone(z as any);
      setLoading(false);
    })();
  }, [code]);

  const submit = async () => {
    if (!qr || !zone) return;
    const parsed = checkinSchema.safeParse({ name: name.trim(), phone: phone.trim() });
    if (!parsed.success) { setError(zodErrorMessage(parsed.error)); return; }
    setError(""); setSubmitting(true);
    const isHazard = zone.zone_type === "danger" || zone.zone_type === "restricted";
    const eventType =
      qr.direction === "exit" ? "exit"
      : isHazard ? "unauthorized_entry"
      : "entry";
    const { error: insErr } = await supabase.from("worker_zone_events").insert({
      project_id: zone.project_id,
      zone_id: zone.id,
      worker_name: parsed.data.name,
      worker_phone: parsed.data.phone || null,
      event_type: eventType,
      source: "qr",
      notes: qr.label || null,
    });
    setSubmitting(false);
    if (insErr) { setError(insErr.message); return; }
    localStorage.setItem("zone:lastName", parsed.data.name);
    if (parsed.data.phone) localStorage.setItem("zone:lastPhone", parsed.data.phone);
    setDone(isHazard && qr.direction === "entry" ? "warn" : "ok");
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (error && !qr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full"><CardContent className="pt-6 text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
          <div className="font-bold">{error}</div>
          <Button variant="outline" onClick={() => navigate("/app/worker/menu")}>홈으로</Button>
        </CardContent></Card>
      </div>
    );
  }

  const hazard = zone && (zone.zone_type === "danger" || zone.zone_type === "restricted");
  const headerBg = hazard
    ? "bg-destructive text-destructive-foreground"
    : qr?.direction === "exit"
      ? "bg-muted-foreground text-background"
      : "bg-primary text-primary-foreground";

  if (done) {
    const isWarn = done === "warn";
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            {isWarn ? (
              <ShieldAlert className="h-16 w-16 text-destructive mx-auto" />
            ) : (
              <CheckCircle2 className="h-16 w-16 text-success mx-auto" />
            )}
            <div className="text-xl font-bold">
              {isWarn ? "⚠ 위험/제한 구역 진입 기록" : qr?.direction === "exit" ? "퇴장 기록 완료" : "입장 기록 완료"}
            </div>
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">구역</div>
              <div className="font-medium">{zone?.name}</div>
            </div>
            <div className="text-sm">{name}</div>
            {isWarn && (
              <div className="p-3 rounded bg-destructive/10 text-destructive text-sm text-left">
                이 구역은 작업허가 없이 출입할 수 없습니다. 즉시 작업담당자/안전관리자에게 알리고 절차를 확인하세요. 본 이벤트는 안전관리자에게 자동 통보되었습니다.
              </div>
            )}
            <Button className="w-full" onClick={() => { setDone(null); }}>다시 체크인</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20">
      <header className={`p-4 ${headerBg}`}>
        <div className="text-xs opacity-80">{qr?.direction === "exit" ? "구역 퇴장" : "구역 입장"} 체크인</div>
        <div className="text-2xl font-bold">{zone?.name}</div>
        <div className="text-sm opacity-90 mt-1">
          {hazard ? "⚠ 위험/제한 구역" : zone?.zone_type === "work" ? "작업구역" : "일반구역"}
        </div>
      </header>
      <main className="p-4 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-4 space-y-3">
            {hazard && qr?.direction === "entry" && (
              <div className="p-3 rounded bg-destructive/10 text-destructive text-sm flex gap-2">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <span>이 구역은 <b>작업허가서</b>가 있는 경우에만 출입할 수 있습니다. 무단 진입은 자동 경고됩니다.</span>
              </div>
            )}
            <div className="space-y-1">
              <Label>이름 *</Label>
              <IMESafeInput defaultValue={name} onCommit={setName} placeholder="홍길동" autoFocus />
            </div>
            <div className="space-y-1">
              <Label>연락처 (선택)</Label>
              <IMESafeInput defaultValue={phone} onCommit={setPhone} placeholder="010-0000-0000" inputMode="tel" applyTermCorrection={false} />
            </div>
            {error && <div className="text-sm text-destructive">{error}</div>}
            <Button className="w-full h-14 text-base" disabled={submitting} onClick={submit}>
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {qr?.direction === "exit" ? "퇴장 기록" : "입장 기록"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              체크인 시각: {new Date().toLocaleString("ko-KR")}
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
