import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";

// The `auth.oauth` namespace is beta; local typed shim so TS compiles.
type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};
const oauthApi = (): OAuthApi => (supabase.auth as any).oauth as OAuthApi;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (!authorizationId) {
          setError("잘못된 요청입니다: authorization_id가 없습니다.");
          return;
        }
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) {
          // Preserve the FULL consent URL so auth returns the user here.
          const next = window.location.pathname + window.location.search;
          window.location.href = "/auth?next=" + encodeURIComponent(next);
          return;
        }
        setUserEmail(sess.session.user.email ?? null);

        const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (error) {
          setError(error.message || "인증 요청 정보를 불러오지 못했습니다.");
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("리다이렉트 주소가 없습니다.");
      return;
    }
    window.location.href = target;
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" /> 인증 요청 오류
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => (window.location.href = "/")}>홈으로</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> 인증 요청을 확인하는 중...
      </div>
    );
  }

  const clientName = details.client?.name ?? details.client?.client_name ?? "외부 애플리케이션";
  const redirectUri = details.client?.redirect_uris?.[0] ?? details.redirect_uri ?? "";
  const scopes: string[] = (details.scope || details.scopes || "openid email profile")
    .toString()
    .split(/\s+/)
    .filter(Boolean);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-lg">
            <span className="text-primary">{clientName}</span> 연결 승인
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            이 애플리케이션이 <span className="font-medium">{userEmail}</span> 계정으로
            SafeNex 안전관리시스템의 도구를 호출할 수 있게 됩니다.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {redirectUri && (
            <div className="rounded-md border bg-muted/30 p-3 text-[11px] break-all">
              <div className="text-muted-foreground mb-1">리다이렉트 URI</div>
              <div className="font-mono">{redirectUri}</div>
            </div>
          )}
          <div className="space-y-1.5">
            <div className="text-xs font-medium">허용되는 권한</div>
            <div className="flex flex-wrap gap-1.5">
              {scopes.map((s) => (
                <Badge key={s} variant="outline" className="text-[11px]">
                  {s}
                </Badge>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              이 앱의 RLS 정책과 백엔드 권한이 여전히 적용되며, 회원님 권한을 넘는 데이터는 접근할 수 없습니다.
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => decide(false)}
            >
              거부
            </Button>
            <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
              {busy ? "처리 중..." : "승인"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
