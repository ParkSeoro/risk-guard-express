import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Video } from "lucide-react";

export default function MobileVisionPair() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { projectId } = useMobileAccess();
  const code = (params.get("code") || "").trim();
  const [busy, setBusy] = useState(false);
  const [authzId, setAuthzId] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    supabase
      .from("vision_device_authorizations" as any)
      .select("id, status, expires_at")
      .eq("user_code", code)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          toast.error("승인 코드를 찾을 수 없습니다");
          return;
        }
        setAuthzId((data as any).id);
      });
  }, [code]);

  const approve = async () => {
    if (!authzId || !projectId) {
      toast.error("프로젝트와 코드를 확인하세요");
      return;
    }
    setBusy(true);
    try {
      const session = await supabase.auth.getSession();
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-fleet/v1/gateway-device-authorizations/${authzId}/approve`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.data.session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project_id: projectId }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || res.statusText);
      toast.success("현장 Gateway가 연결되었습니다");
      navigate("/app/worker/today");
    } catch (e: any) {
      toast.error(e?.message || "승인 실패");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-vision-pair">
      <MobilePageHeader title="비전 Gateway 승인" onBack={() => navigate("/app/worker/today")} />
      <main className="px-4 pb-8 space-y-3">
        <Card>
          <CardContent className="p-4 space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Video className="h-4 w-4" /> 확인 코드 {code || "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              현장 PC의 QR을 스캔한 화면입니다. 이 프로젝트에 Gateway를 연결합니다. NVR 암호는 전송되지 않습니다.
            </p>
            {!user && <p className="text-xs text-destructive">로그인이 필요합니다.</p>}
            {!projectId && <p className="text-xs text-destructive">모바일에서 현장을 선택하세요.</p>}
            <Button className="w-full" disabled={busy || !authzId || !projectId} onClick={() => void approve()}>
              이 현장으로 승인
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
