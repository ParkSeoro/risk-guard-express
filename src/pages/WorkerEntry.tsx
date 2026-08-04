import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HardHat, LogIn, UserPlus } from "lucide-react";

/**
 * Legacy QR-only worker entry — accounts are required.
 * Redirects saved portal tokens away; offers login / Auth signup.
 */
export default function WorkerEntry() {
  const navigate = useNavigate();

  useEffect(() => {
    // Clear legacy QR-only session token
    try {
      localStorage.removeItem("workerToken");
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle>근로자 로그인</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-3 rounded text-sm space-y-1">
            <div className="font-semibold">계정 로그인이 필요합니다</div>
            <div className="text-muted-foreground">
              QR만으로 사용하는 비로그인 포털은 종료되었습니다. 현장 등록 QR로 회원가입하거나
              기존 계정으로 로그인하세요.
            </div>
          </div>
          <Button className="w-full h-12" onClick={() => navigate("/login")}>
            <LogIn className="h-4 w-4 mr-2" /> 로그인
          </Button>
          <Button className="w-full h-12" variant="outline" onClick={() => navigate("/register?audience=worker")}>
            <UserPlus className="h-4 w-4 mr-2" /> 근로자 회원가입
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            등록 QR이 있으면 스캔해 주세요.{" "}
            <Link to="/worker/register" className="underline">등록 안내</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
