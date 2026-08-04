import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Legacy QR-only portal — retired. Accounts required.
 * Deep links from old QR stickers land here and are sent to Auth.
 */
export default function WorkerPortal() {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    try {
      localStorage.removeItem("workerToken");
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => {
      navigate("/login", { replace: true, state: { fromPortalToken: token || null } });
    }, 1200);
    return () => clearTimeout(t);
  }, [navigate, token]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 space-y-3 text-center text-sm">
          <Loader2 className="h-5 w-5 animate-spin mx-auto" />
          <div className="font-semibold">계정 로그인이 필요합니다</div>
          <p className="text-muted-foreground">
            QR 전용 포털은 종료되었습니다. 로그인 화면으로 이동합니다.
          </p>
          <Button className="w-full" onClick={() => navigate("/login", { replace: true })}>
            지금 로그인
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
