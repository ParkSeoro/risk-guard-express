import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import * as P from "@/routes/lazyPages";

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      화면 로딩 중…
    </div>
  );
}

/**
 * Worker shell routes — NO Leaflet / Recharts admin pages.
 * Mounted at /app/worker/* and aliased from /m/* for compatibility.
 */
export default function WorkerAppRoutes() {
  return (
    <Suspense fallback={<Fallback />}>
      <Routes>
        <Route index element={<P.LazyMobileHome />} />
        <Route path="inspect" element={<P.LazyMobileInspect />} />
        <Route path="alerts" element={<P.LazyMobileAlerts />} />
        <Route path="actions" element={<P.LazyMobileActions />} />
        <Route path="approvals" element={<P.LazyMobileApprovals />} />
        <Route path="approvals/:approvalId" element={<P.LazyMobileApprovalDetail />} />
        <Route path="workers" element={<P.LazyMobileWorkers />} />
        <Route path="risk-assessment" element={<P.LazyMobileRiskAssessment />} />
        <Route path="risk-assessment/:runId" element={<P.LazyMobileAssessmentViewer />} />
        <Route path="work-plans" element={<P.LazyMobileWorkPlans />} />
        <Route path="work-plans/:planId" element={<P.LazyMobileWorkPlanViewer />} />
        <Route path="tbm" element={<P.LazyMobileTbm />} />
        <Route path="permits" element={<P.LazyMobilePermits />} />
        <Route path="incident" element={<P.LazyMobileIncident />} />
        <Route path="scan" element={<P.LazyMobileScan />} />
        <Route path="daily-health-log" element={<P.LazyMobileDailyHealthLog />} />
        <Route path="work-stop" element={<P.LazyMobileWorkStop />} />
        <Route path="geofence-drop" element={<P.LazyMobileGeofenceDrop />} />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </Suspense>
  );
}
