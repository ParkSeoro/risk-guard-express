import WorkerDailyHome from "@/pages/WorkerDailyHome";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { useMobileSubpageBack } from "@/lib/mobileNav";

/** 더보기 → 위치·GPS. Home hides the diagnostic card after clock-in. */
export default function WorkerGpsLocation() {
  const onBack = useMobileSubpageBack("/app/worker/more");
  return (
    <div className="max-w-md mx-auto" data-testid="worker-gps-location">
      <MobilePageHeader
        title="위치 · GPS"
        subtitle="출근 후 홈에서는 숨깁니다. 추적은 백그라운드에서 유지됩니다."
        onBack={onBack}
      />
      <div className="px-4 pb-8 space-y-3">
        <WorkerDailyHome embedded diagnosticsOnly />
      </div>
    </div>
  );
}
