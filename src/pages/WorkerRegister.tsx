/**
 * Legacy /worker/register?project=&company= → Auth 근로자 가입(QR 컨텍스트).
 * iPhone: Safari 웹 가입이 공식 경로 (App Store 없음). Android: Play 앱 권장 + 웹 가능.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { HardHat, Download, Share, Plus, Smartphone } from "lucide-react";
import { openPlayStore, playStoreWebUrl } from "@/lib/playStore";
import { isNativeApp } from "@/lib/native/isNativeApp";
import { isIosWebClient } from "@/lib/iosWebPath";

export default function WorkerRegister() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get("project") || "";
  const companyId = params.get("company") || "";
  const iosWeb = useMemo(() => isIosWebClient(), []);
  const [showIosHowTo, setShowIosHowTo] = useState(false);

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

      {iosWeb ? (
        <>
          <p className="text-sm text-muted-foreground leading-relaxed">
            iPhone은 App Store 앱이 없습니다.{" "}
            <b className="text-foreground">Safari에서 바로 가입</b>하면 Android 앱과 같은
            화면·기능을 씁니다. (백그라운드 GPS·무음 사이렌만 앱 전용)
          </p>
          <Button className="w-full h-12" asChild>
            <Link to={signupUrl}>
              <Smartphone className="h-4 w-4 mr-2" />
              Safari에서 가입 계속
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full h-11"
            onClick={() => setShowIosHowTo((v) => !v)}
          >
            <Share className="h-4 w-4 mr-2" />
            홈 화면에 추가하는 방법
          </Button>
          {showIosHowTo && (
            <ol className="w-full text-left text-xs text-muted-foreground space-y-1.5 rounded-lg border bg-muted/40 p-3">
              <li className="flex items-start gap-2">
                <span>1.</span>
                <span>
                  가입·로그인 후 Safari 하단 <Share className="inline h-3.5 w-3.5" /> 공유 →{" "}
                  <Plus className="inline h-3.5 w-3.5" /> 「홈 화면에 추가」
                </span>
              </li>
              <li>2. 홈 화면 아이콘으로 열면 앱처럼 사용 · 푸시 알림도 가능합니다</li>
              <li>3. Safari 탭만 열어두면 푸시가 안 올 수 있습니다</li>
            </ol>
          )}
        </>
      ) : (
        <>
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
          {!isNativeApp() && (
            <a
              href={playStoreWebUrl()}
              className="text-xs text-muted-foreground underline"
              target="_blank"
              rel="noreferrer"
            >
              {playStoreWebUrl()}
            </a>
          )}
        </>
      )}
    </div>
  );
}
