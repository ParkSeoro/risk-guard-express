import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import * as P from "@/routes/lazyPages";
import AuthGuard from "@/components/AuthGuard";
import WorkerGlobalGps from "@/components/worker/WorkerGlobalGps";
import { useAuth } from "@/contexts/AuthContext";
import { isPureWorkerUser } from "@/components/AuthGuard";

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      화면 로딩 중…
    </div>
  );
}

function WorkerGpsGate() {
  const { profile, roles } = useAuth();
  // GPS only after worker location consent (admins may lack agreed_to_location)
  if (isPureWorkerUser(roles) && profile?.agreed_to_location !== true) {
    return null;
  }
  return <WorkerGlobalGps />;
}

/**
 * Worker shell routes — AuthGuard + consent intercept + GPS after consent.
 */
export default function WorkerAppRoutes() {
  return (
    <AuthGuard shell="worker">
      <WorkerGpsGate />
      <Suspense fallback={<Fallback />}>
        <Routes>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="onboarding" element={<Navigate to="/consent" replace />} />
          <Route path="consent" element={<Navigate to="/consent" replace />} />
          <Route path="home" element={<P.LazyWorkerDailyHome />} />
          <Route path="menu" element={<P.LazyMobileHome />} />
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
          <Route path="*" element={<Navigate to="home" replace />} />
        </Routes>
      </Suspense>
    </AuthGuard>
  );
}
