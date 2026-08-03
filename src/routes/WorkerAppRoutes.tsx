import { Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import * as P from "@/routes/lazyPages";
import AuthGuard from "@/components/AuthGuard";
import WorkerGlobalGps from "@/components/worker/WorkerGlobalGps";
import ShellGeofenceAlerts from "@/components/geofence/ShellGeofenceAlerts";
import MobileShell from "@/components/mobile/MobileShell";
import { MobilePreviewGate } from "@/contexts/PreviewContext";
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
  if (isPureWorkerUser(roles) && profile?.agreed_to_location !== true) {
    return null;
  }
  return <WorkerGlobalGps />;
}

/**
 * Worker shell routes — AuthGuard + consent intercept + GPS after consent.
 * v1: MobileShell (bottom nav + work-stop) wraps all operational pages.
 */
export default function WorkerAppRoutes() {
  return (
    <AuthGuard shell="worker">
      <MobilePreviewGate>
        <WorkerGpsGate />
        <ShellGeofenceAlerts />
        <MobileShell>
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route index element={<Navigate to="today" replace />} />
              <Route path="onboarding" element={<Navigate to="/consent" replace />} />
              <Route path="consent" element={<Navigate to="/consent" replace />} />
              <Route path="today" element={<P.LazyMobileToday />} />
              <Route path="tasks" element={<P.LazyMobileTasks />} />
              <Route path="docs" element={<P.LazyMobileDocs />} />
              <Route path="more" element={<P.LazyMobileMore />} />
              <Route path="account" element={<P.LazySettingsAccount />} />
              {/* legacy aliases */}
              <Route path="home" element={<Navigate to="today" replace />} />
              <Route path="menu" element={<Navigate to="today" replace />} />
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
              {/* permits remain as document viewer entry; approvals is the single inbox */}
              <Route path="permits" element={<P.LazyMobilePermits />} />
              <Route path="incident" element={<P.LazyMobileIncident />} />
              <Route path="scan" element={<P.LazyMobileScan />} />
              <Route path="daily-health-log" element={<P.LazyMobileDailyHealthLog />} />
              <Route path="work-stop" element={<P.LazyMobileWorkStop />} />
              <Route path="geofence-drop" element={<P.LazyMobileGeofenceDrop />} />
              <Route path="*" element={<Navigate to="today" replace />} />
            </Routes>
          </Suspense>
        </MobileShell>
      </MobilePreviewGate>
    </AuthGuard>
  );
}
