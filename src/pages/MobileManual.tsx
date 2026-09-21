import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { useMobileSubpageBack } from "@/lib/mobileNav";
import Manual from "@/pages/Manual";

export default function MobileManual() {
  const onBack = useMobileSubpageBack("/app/worker/more");

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-manual">
      <MobilePageHeader title="사용 설명서" subtitle="역할을 고르면 자기 설명만 보입니다" onBack={onBack} />
      <Manual embedded />
    </div>
  );
}
