import { Suspense, useEffect, useState } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import ContractorGate from "@/components/ContractorGate";
import RoleGuard from "@/components/RoleGuard";
import AuthGuard from "@/components/AuthGuard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import * as P from "@/routes/lazyPages";

function Fallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      관리 화면 로딩 중…
    </div>
  );
}

/**
 * Manager/Admin shell — Leaflet maps, charts, settings load only here.
 * Mounted at /app/admin/* ; legacy /* paths redirect into this tree.
 */
function AdminAppRoutesInner() {
  const { user, loading, profile, hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [hasProject, setHasProject] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    if (isMaster) {
      setHasProject(true);
      return;
    }
    supabase
      .from("project_members")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .then(({ count }) => setHasProject((count || 0) > 0));
  }, [user?.id, isMaster]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        로딩 중...
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  if (profile && (profile as any).account_status === "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-xl font-bold">승인 대기 중</h2>
          <p className="text-sm text-muted-foreground">
            관리자가 계정을 승인한 후에 시스템을 이용하실 수 있습니다.
          </p>
          <button onClick={() => window.location.reload()} className="text-sm text-accent hover:underline">
            새로고침
          </button>
        </div>
      </div>
    );
  }

  if (profile && (profile as any).account_status === "inactive") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-xl font-bold text-destructive">계정 비활성화</h2>
          <p className="text-sm text-muted-foreground">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  if (hasProject === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">로딩 중...</div>
    );
  }
  if (!hasProject && !isMaster) {
    return (
      <Suspense fallback={<Fallback />}>
        <P.LazyProjectSelect />
      </Suspense>
    );
  }

  return (
    <AppLayout>
      <ContractorGate>
        <Suspense fallback={<Fallback />}>
          <Routes>
            <Route index element={<P.LazyDashboard />} />
            <Route path="projects" element={<P.LazyProjects />} />
            <Route path="project/:projectId" element={<P.LazyProjectDetail />} />
            <Route path="risk-assessment" element={<P.LazyAssessmentRuns />} />
            <Route path="risk-assessment/:projectId" element={<P.LazyAssessmentRuns />} />
            <Route path="assessment-run/:runId" element={<P.LazyAssessmentRunDetail />} />
            <Route path="schedule-upload" element={<P.LazyScheduleUpload />} />
            <Route path="schedule-upload/:projectId" element={<P.LazyScheduleUpload />} />
            <Route path="verification" element={<Navigate to="/app/admin/verification-center" replace />} />
            <Route path="verification-center" element={<P.LazyVerificationCenter />} />
            <Route path="master-data" element={<RoleGuard><P.LazyMasterData /></RoleGuard>} />
            <Route path="risk-library" element={<RoleGuard masterOnly><P.LazyGlobalRiskLibrary /></RoleGuard>} />
            <Route path="admin/risk-library" element={<RoleGuard masterOnly><P.LazyGlobalRiskLibrary /></RoleGuard>} />
            <Route path="approvals" element={<P.LazyApprovals />} />
            <Route path="audit-logs" element={<RoleGuard><P.LazyAuditLogs /></RoleGuard>} />
            <Route path="user-management" element={<Navigate to="/app/admin/settings/permissions" replace />} />
            <Route path="permission-test" element={<RoleGuard><P.LazyPermissionTest /></RoleGuard>} />
            <Route path="profile" element={<P.LazyProfile />} />
            <Route path="settings" element={<RoleGuard><P.LazySettings /></RoleGuard>} />
            <Route path="settings/account" element={<P.LazySettingsAccount />} />
            <Route path="settings/permissions" element={<RoleGuard><P.LazySettingsPermissions /></RoleGuard>} />
            <Route path="settings/approval-routes" element={<RoleGuard><P.LazySettingsApprovalRoutes /></RoleGuard>} />
            <Route path="settings/notifications" element={<RoleGuard><P.LazySettingsNotifications /></RoleGuard>} />
            <Route path="settings/ai" element={<RoleGuard><P.LazySettingsAI /></RoleGuard>} />
            <Route path="settings/weather" element={<RoleGuard masterOnly><P.LazySettingsWeather /></RoleGuard>} />
            <Route path="settings/mobile-preview" element={<RoleGuard masterOnly><P.LazyMobilePreviewHost /></RoleGuard>} />
            <Route path="settings/mobile-releases" element={<RoleGuard masterOnly><P.LazyMobileReleases /></RoleGuard>} />
            <Route path="settings/permit-forms" element={<RoleGuard><P.LazySettingsPermitForms /></RoleGuard>} />
            <Route path="settings/work-plan-attachments" element={<RoleGuard><P.LazySettingsWorkPlanAttachments /></RoleGuard>} />
            <Route path="settings/companies" element={<RoleGuard><P.LazySettingsCompanies /></RoleGuard>} />
            <Route path="work-plans" element={<P.LazyWorkPlans />} />
            <Route path="work-plan/:planId" element={<P.LazyWorkPlanDetail />} />
            <Route path="legal-duties" element={<P.LazyLegalDuties />} />
            <Route path="todo" element={<P.LazyTodoDashboard />} />
            <Route path="todos" element={<Navigate to="/app/admin/todo" replace />} />
            <Route path="ai-assistant" element={<P.LazyAIAssistant />} />
            <Route path="site-weather" element={<P.LazySiteWeather />} />
            <Route path="safety-cost" element={<RoleGuard><P.LazySafetyCost /></RoleGuard>} />
            <Route path="work-permits" element={<P.LazyWorkPermits />} />
            <Route path="work-permits/:id" element={<P.LazyWorkPermitDetail />} />
            <Route path="tbm-logs" element={<P.LazyTbmLogs />} />
            <Route path="inspection-mode" element={<P.LazyInspectionMode />} />
            <Route path="safety-inspections" element={<P.LazySafetyInspections />} />
            <Route path="incidents" element={<P.LazyIncidents />} />
            <Route path="emergency-drills" element={<P.LazyEmergencyDrills />} />
            <Route path="worker-education" element={<P.LazyWorkerEducation />} />
            <Route path="safety-appointments" element={<P.LazySafetyAppointments />} />
            <Route path="work-stop" element={<P.LazyWorkStopRequests />} />
            <Route path="contractor-scorecard" element={<RoleGuard><P.LazyContractorScorecard /></RoleGuard>} />
            <Route path="assessment-notices" element={<RoleGuard><P.LazyAssessmentNotices /></RoleGuard>} />
            <Route path="announcements" element={<P.LazyProjectAnnouncements />} />
            <Route
              path="vision-fleet"
              element={
                <RoleGuard allowed={["master", "project_admin", "safety_manager", "site_manager", "supervisor", "site_supervisor"]}>
                  <P.LazyVisionFleet />
                </RoleGuard>
              }
            />
            <Route path="safety-cost-validation" element={<Navigate to="/app/admin/safety-cost?tab=validation" replace />} />
            <Route path="site-readiness" element={<P.LazySiteReadinessChecklist />} />
            <Route path="education-materials" element={<P.LazyEducationMaterials />} />
            <Route path="project-library" element={<P.LazyProjectLibrary />} />
            <Route path="workers" element={<P.LazyWorkerManagement />} />
            <Route path="workers/legal-mapping" element={<P.LazyLegalEducationMapping />} />
            <Route path="workers/:id" element={<P.LazyWorkerDetail />} />
            <Route path="worker-attendance" element={<Navigate to="/app/admin/workers?tab=attendance" replace />} />
            <Route path="admin/ai-test" element={<RoleGuard masterOnly><P.LazyAITestEngine /></RoleGuard>} />
            <Route path="admin/ai-logs" element={<RoleGuard masterOnly><P.LazyAILogs /></RoleGuard>} />
            <Route path="admin/system-test" element={<RoleGuard masterOnly><P.LazySystemTestEngine /></RoleGuard>} />
            <Route path="admin/consistency-audit" element={<Navigate to="/app/admin/system-test" replace />} />
            <Route path="admin/data-audit" element={<RoleGuard masterOnly><P.LazyDataAudit /></RoleGuard>} />
            <Route path="admin/trash" element={<RoleGuard masterOnly><P.LazyTrash /></RoleGuard>} />
            <Route path="health" element={<P.LazyHealthDashboard />} />
            <Route path="health/checkups" element={<P.LazyHealthCheckups />} />
            <Route path="health/chemicals" element={<P.LazyChemicals />} />
            <Route path="health/measurements" element={<P.LazyEnvMeasurements />} />
            <Route path="health/education" element={<P.LazyHealthEducation />} />
            <Route path="health/hazard-surveys" element={<P.LazyHazardSurveys />} />
            <Route path="site-control-map" element={<P.LazySiteControlMap />} />
            <Route path="site-maps" element={<Navigate to="/app/admin/site-control-map" replace />} />
            <Route path="restricted-zones" element={<Navigate to="/app/admin/site-control-map" replace />} />
            <Route path="georef-map" element={<Navigate to="/app/admin/site-control-map" replace />} />
            <Route path="zone-events" element={<P.LazyZoneEvents />} />
            <Route path="worker-distribution" element={<P.LazyWorkerDistribution />} />
            <Route path="admin/tracking-health" element={<RoleGuard><P.LazyAdminTrackingHealth /></RoleGuard>} />
            <Route path="companies" element={<P.LazyCompanies />} />
            <Route path="companies/:id" element={<P.LazyCompanyDetail />} />
            <Route path="*" element={<P.LazyNotFound />} />
          </Routes>
        </Suspense>
      </ContractorGate>
    </AppLayout>
  );
}

export default function AdminAppRoutes() {
  return (
    <AuthGuard shell="admin">
      <AdminAppRoutesInner />
    </AuthGuard>
  );
}

/** Legacy absolute paths → /app/admin/... */
export function LegacyAdminRedirect({ suffix = "" }: { suffix?: string }) {
  const params = useParams();
  let path = suffix;
  Object.entries(params).forEach(([k, v]) => {
    path = path.replace(`:${k}`, v || "");
  });
  return <Navigate to={`/app/admin${path.startsWith("/") ? path : `/${path}`}`} replace />;
}
