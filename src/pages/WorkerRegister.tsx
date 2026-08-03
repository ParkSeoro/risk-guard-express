/**
 * Legacy /worker/register?project=&company= → Auth 근로자 가입(QR 컨텍스트).
 * 무계정 register_worker 경로는 사용하지 않음.
 */
import { useEffect, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HardHat, Download } from "lucide-react";
import { openPlayStore, playStoreWebUrl } from "@/lib/playStore";
import { isNativeApp } from "@/lib/native/isNativeApp";

export default function WorkerRegister() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get("project") || "";
  const companyId = params.get("company") || "";

  const signupUrl = useMemo(() => {
    if (!projectId || !companyId) return "";
    const q = new URLSearchParams({
      audience: "worker",
      project: projectId,
      company: companyId,
    });
    return `/register?${q.toString()}`;
  }, [projectId, companyId]);

  useEffect(() => {
    if (signupUrl && isNativeApp()) {
      navigate(signupUrl, { replace: true });
    }
  }, [signupUrl, navigate]);

  if (!projectId || !companyId) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-3 text-center native-safe-pad">
        <HardHat className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-bold">등록 QR이 올바르지 않습니다</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          관리자가 소속사까지 지정한 등록 QR을 다시 스캔해 주세요.
        </p>
        <Button variant="outline" asChild>
          <Link to="/login">로그인으로</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 gap-4 text-center native-safe-pad max-w-md mx-auto">
      <HardHat className="h-10 w-10 text-primary" />
      <h1 className="text-xl font-bold">SafeNex 근로자 등록</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        계정 가입이 필요합니다. 앱이 있으면 앱에서, 없으면 Play 스토어에서 설치한 뒤
        같은 QR로 가입하거나 아래 버튼으로 웹 가입을 진행하세요.
      </p>
      {!isNativeApp() && (
        <Button className="w-full h-12" variant="secondary" onClick={() => openPlayStore()}>
          <Download className="h-4 w-4 mr-2" />
          앱 다운로드 (Play 스토어)
        </Button>
      )}
      <Button className="w-full h-12" asChild>
        <Link to={signupUrl}>전화번호로 가입 계속</Link>
      </Button>
      <a
        href={playStoreWebUrl()}
        className="text-xs text-muted-foreground underline"
        target="_blank"
        rel="noreferrer"
      >
        {playStoreWebUrl()}
      </a>
    </div>
  );
}
