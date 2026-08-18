import { useNavigate } from "react-router-dom";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import SiteWeather from "@/pages/SiteWeather";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { Card, CardContent } from "@/components/ui/card";

/** Worker-shell 현장 일기예보 — same data as desktop, mobile layout + radar. */
export default function MobileSiteWeather() {
  const { projectId } = useMobileAccess();
  const navigate = useNavigate();
  const goHome = useNavigateMobileHome();

  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    goHome();
  };

  return (
    <div className="max-w-lg mx-auto min-w-0" data-testid="mobile-site-weather">
      <MobilePageHeader title="현장 일기예보" subtitle="레이더 · 시간별 · 영향분석" onBack={onBack} />
      {!projectId ? (
        <Card className="mx-4">
          <CardContent className="pt-4 text-sm text-muted-foreground">
            프로젝트를 먼저 선택하세요.
          </CardContent>
        </Card>
      ) : (
        <div className="px-3 min-w-0 overflow-x-auto">
          <SiteWeather projectId={projectId} layout="mobile" />
        </div>
      )}
    </div>
  );
}
