import WorkerDailyHome from "@/pages/WorkerDailyHome";

/** 더보기 → 위치·GPS. Home hides the diagnostic card after clock-in. */
export default function WorkerGpsLocation() {
  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="worker-gps-location">
      <div>
        <h1 className="text-base font-bold">위치 · GPS</h1>
        <p className="text-xs text-muted-foreground">
          출근 후 홈에서는 숨깁니다. 추적은 백그라운드에서 유지됩니다.
        </p>
      </div>
      <WorkerDailyHome embedded diagnosticsOnly />
    </div>
  );
}
