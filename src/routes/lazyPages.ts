/**
 * Lazy page registry — keeps Leaflet / Recharts / admin charts out of the worker chunk.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type LazyPage = LazyExoticComponent<ComponentType<any>>;

function L(factory: () => Promise<{ default: ComponentType<any> }>): LazyPage {
  return lazy(factory);
}

// ── Worker / mobile (light) ──────────────────────────────────
export const LazyMobileHome = L(() => import("@/pages/MobileHome"));
export const LazyMobileToday = L(() => import("@/pages/MobileToday"));
export const LazyMobileAnnouncements = L(() => import("@/pages/MobileAnnouncements"));
export const LazyMobileTasks = L(() => import("@/pages/MobileTasks"));
export const LazyMobileDocs = L(() => import("@/pages/MobileDocs"));
export const LazyMobileMore = L(() => import("@/pages/MobileMore"));
export const LazyMobilePreviewHost = L(() => import("@/pages/MobilePreviewHost"));
export const LazyWorkerDailyHome = L(() => import("@/pages/WorkerDailyHome"));
export const LazyWorkerConsentPage = L(() => import("@/pages/WorkerConsentPage"));
export const LazyMobileInspect = L(() => import("@/pages/MobileInspect"));
export const LazyMobileAlerts = L(() => import("@/pages/MobileAlerts"));
export const LazyMobileActions = L(() => import("@/pages/MobileActions"));
export const LazyMobileApprovals = L(() => import("@/pages/MobileApprovals"));
export const LazyMobileApprovalDetail = L(() => import("@/pages/MobileApprovalDetail"));
export const LazyMobileWorkers = L(() => import("@/pages/MobileWorkers"));
export const LazyMobileRiskAssessment = L(() => import("@/pages/MobileRiskAssessment"));
export const LazyMobileAssessmentViewer = L(() => import("@/pages/MobileAssessmentViewer"));
export const LazyMobileWorkPlans = L(() => import("@/pages/MobileWorkPlans"));
export const LazyMobileWorkPlanViewer = L(() => import("@/pages/MobileWorkPlanViewer"));
export const LazyMobileTbm = L(() => import("@/pages/MobileTbm"));
export const LazyMobilePermits = L(() => import("@/pages/MobilePermits"));
export const LazyMobileIncident = L(() => import("@/pages/MobileIncident"));
export const LazyMobileScan = L(() => import("@/pages/MobileScan"));
export const LazyMobileDailyHealthLog = L(() => import("@/pages/MobileDailyHealthLog"));
export const LazyMobileWorkStop = L(() => import("@/pages/MobileWorkStop"));
export const LazyMobileGeofenceDrop = L(() => import("@/pages/MobileGeofenceDrop"));
export const LazyMobileMapCalibration = L(() => import("@/pages/MobileMapCalibration"));
export const LazyMobileSiteWeather = L(() => import("@/pages/MobileSiteWeather"));
export const LazyMobilePpeReceipt = L(() => import("@/pages/MobilePpeReceipt"));
export const LazyWorkerPortal = L(() => import("@/pages/WorkerPortal"));
export const LazyWorkerEntry = L(() => import("@/pages/WorkerEntry"));
export const LazyWorkerRegister = L(() => import("@/pages/WorkerRegister"));
export const LazyTbmParticipate = L(() => import("@/pages/TbmParticipate"));
export const LazyZoneCheckin = L(() => import("@/pages/ZoneCheckin"));

// ── Admin / manager (heavy — charts, leaflet, designers) ─────
export const LazyDashboard = L(() => import("@/pages/Dashboard"));
export const LazyProjects = L(() => import("@/pages/Projects"));
export const LazyProjectDetail = L(() => import("@/pages/ProjectDetail"));
export const LazyProjectSelect = L(() => import("@/pages/ProjectSelect"));
export const LazyAssessmentRuns = L(() => import("@/pages/AssessmentRuns"));
export const LazyAssessmentRunDetail = L(() => import("@/pages/AssessmentRunDetail"));
export const LazyMasterData = L(() => import("@/pages/MasterData"));
export const LazyGlobalRiskLibrary = L(() => import("@/pages/GlobalRiskLibrary"));
export const LazyApprovals = L(() => import("@/pages/Approvals"));
export const LazyVerificationCenter = L(() => import("@/pages/VerificationCenter"));
export const LazyScheduleUpload = L(() => import("@/pages/ScheduleUpload"));
export const LazyAuditLogs = L(() => import("@/pages/AuditLogs"));
export const LazyPermissionTest = L(() => import("@/pages/PermissionTest"));
export const LazyProfile = L(() => import("@/pages/Profile"));
export const LazySettings = L(() => import("@/pages/Settings"));
export const LazySettingsAccount = L(() => import("@/pages/SettingsAccount"));
export const LazySettingsPermissions = L(() => import("@/pages/SettingsPermissions"));
export const LazySettingsApprovalRoutes = L(() => import("@/pages/SettingsApprovalRoutes"));
export const LazySettingsNotifications = L(() => import("@/pages/SettingsNotifications"));
export const LazySettingsAI = L(() => import("@/pages/SettingsAI"));
export const LazySettingsWeather = L(() => import("@/pages/SettingsWeather"));
export const LazyMobileReleases = L(() => import("@/pages/MobileReleases"));
export const LazySettingsPermitForms = L(() => import("@/pages/SettingsPermitForms"));
export const LazySettingsWorkPlanAttachments = L(() => import("@/pages/SettingsWorkPlanAttachments"));
export const LazySettingsCompanies = L(() => import("@/pages/SettingsCompanies"));
export const LazyWorkPlans = L(() => import("@/pages/WorkPlans"));
export const LazyWorkPlanDetail = L(() => import("@/pages/WorkPlanDetail"));
export const LazyLegalDuties = L(() => import("@/pages/LegalDuties"));
export const LazyTodoDashboard = L(() => import("@/pages/TodoDashboard"));
export const LazyAIAssistant = L(() => import("@/pages/AIAssistant"));
export const LazySiteWeather = L(() => import("@/pages/SiteWeather"));
export const LazySafetyCost = L(() => import("@/pages/SafetyCost"));
export const LazyWorkPermits = L(() => import("@/pages/WorkPermits"));
export const LazyWorkPermitDetail = L(() => import("@/pages/WorkPermitDetail"));
export const LazyTbmLogs = L(() => import("@/pages/TbmLogs"));
export const LazyInspectionMode = L(() => import("@/pages/InspectionMode"));
export const LazySafetyInspections = L(() => import("@/pages/SafetyInspections"));
export const LazySiteReadinessChecklist = L(() => import("@/pages/SiteReadinessChecklist"));
export const LazyEducationMaterials = L(() => import("@/pages/EducationMaterials"));
export const LazyProjectLibrary = L(() => import("@/pages/ProjectLibrary"));
export const LazyWorkerManagement = L(() => import("@/pages/WorkerManagement"));
export const LazyWorkerDetail = L(() => import("@/pages/WorkerDetail"));
export const LazyLegalEducationMapping = L(() => import("@/pages/LegalEducationMapping"));
export const LazyIncidents = L(() => import("@/pages/Incidents"));
export const LazyEmergencyDrills = L(() => import("@/pages/EmergencyDrills"));
export const LazyWorkerEducation = L(() => import("@/pages/WorkerEducation"));
export const LazySafetyAppointments = L(() => import("@/pages/SafetyAppointments"));
export const LazyWorkStopRequests = L(() => import("@/pages/WorkStopRequests"));
export const LazyContractorScorecard = L(() => import("@/pages/ContractorScorecard"));
export const LazyAssessmentNotices = L(() => import("@/pages/AssessmentNotices"));
export const LazyProjectAnnouncements = L(() => import("@/pages/ProjectAnnouncements"));
export const LazyVisionFleet = L(() => import("@/pages/VisionFleet"));
export const LazyMobileVisionPair = L(() => import("@/pages/MobileVisionPair"));
export const LazyMobileVisionEvents = L(() => import("@/pages/MobileVisionEvents"));
export const LazySafetyCostValidation = L(() => import("@/pages/SafetyCostValidation"));
export const LazyAITestEngine = L(() => import("@/pages/AITestEngine"));
export const LazyAILogs = L(() => import("@/pages/AILogs"));
export const LazySystemTestEngine = L(() => import("@/pages/SystemTestEngine"));
export const LazyDataAudit = L(() => import("@/pages/DataAudit"));
export const LazyTrash = L(() => import("@/pages/Trash"));
export const LazyHealthDashboard = L(() => import("@/pages/health/HealthDashboard"));
export const LazyHealthCheckups = L(() => import("@/pages/health/HealthCheckups"));
export const LazyChemicals = L(() => import("@/pages/health/Chemicals"));
export const LazyEnvMeasurements = L(() => import("@/pages/health/EnvMeasurements"));
export const LazyHealthEducation = L(() => import("@/pages/health/HealthEducation"));
export const LazyHazardSurveys = L(() => import("@/pages/health/HazardSurveys"));
/** Leaflet map — admin-only chunk */
export const LazySiteControlMap = L(() => import("@/pages/SiteControlMap"));
export const LazyZoneEvents = L(() => import("@/pages/ZoneEvents"));
export const LazyWorkerDistribution = L(() => import("@/pages/WorkerDistribution"));
export const LazyAdminTrackingHealth = L(() => import("@/pages/AdminTrackingHealth"));
export const LazyCompanies = L(() => import("@/pages/Companies"));
export const LazyCompanyDetail = L(() => import("@/pages/CompanyDetail"));
export const LazyNotFound = L(() => import("@/pages/NotFound"));
