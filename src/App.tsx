import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useSearchParams, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { Suspense, lazy } from "react";
import SystemRealtimeProvider from "@/providers/SystemRealtimeProvider";
import MobileRedirectGuard from "@/components/MobileRedirectGuard";
import InstallPrompt from "@/components/InstallPrompt";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import AdminAppRoutes from "@/routes/AdminAppRoutes";
import WorkerAppRoutes from "@/routes/WorkerAppRoutes";
import { postLoginPath } from "@/components/AuthGuard";
import { prefersMobileAppShell } from "@/hooks/use-mobile";

const Auth = lazy(() => import("@/pages/Auth"));
const Index = lazy(() => import("@/pages/Index"));
const Privacy = lazy(() => import("@/pages/Privacy"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const UpdatePassword = lazy(() => import("@/pages/UpdatePassword"));
const OAuthConsent = lazy(() => import("@/pages/OAuthConsent"));
const TbmParticipate = lazy(() => import("@/pages/TbmParticipate"));
const WorkerRegister = lazy(() => import("@/pages/WorkerRegister"));
const WorkerEntry = lazy(() => import("@/pages/WorkerEntry"));
const WorkerPortal = lazy(() => import("@/pages/WorkerPortal"));
const HazardSurveyResponse = lazy(() => import("@/pages/health/HazardSurveyResponse"));
const ZoneCheckin = lazy(() => import("@/pages/ZoneCheckin"));
const CompanyScan = lazy(() => import("@/pages/CompanyScan"));
const Manual = lazy(() => import("@/pages/Manual"));
const ConsentPage = lazy(() => import("@/pages/ConsentPage"));

const queryClient = new QueryClient();

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      로딩 중…
    </div>
  );
}

function AuthRoute() {
  const { user, isAuthLoading, roles, rolesReady, profile } = useAuth();
  const [params] = useSearchParams();
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        세션 확인 중…
      </div>
    );
  }
  if (user) {
    if (!rolesReady) {
      return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
          세션 확인 중…
        </div>
      );
    }
    const dest = postLoginPath(roles, profile, { rolesReady });
    const next = params.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//") && next !== "/consent" && next !== "/") {
      if (dest === "/consent") {
        return <Navigate to="/consent" replace />;
      }
      // Phone: keep managers on mobile shell even if ?next=/app/admin
      if (prefersMobileAppShell() && next.startsWith("/app/admin") && dest.startsWith("/app/worker")) {
        return <Navigate to={dest} replace />;
      }
      // Desktop: prefer explicit admin deep-link over a stale worker dest
      if (next.startsWith("/app/admin") && dest.startsWith("/app/worker")) {
        return <Navigate to={next} replace />;
      }
      return <Navigate to={next} replace />;
    }
    return <Navigate to={dest === "/" ? "/consent" : dest} replace />;
  }
  return <Auth />;
}

/** Map legacy desktop paths → /app/admin/... and /m → /app/worker */
function LegacyPathRedirect() {
  const loc = useLocation();
  const path = loc.pathname;

  if (path === "/" || path === "") {
    return <RoleAwareRootRedirect />;
  }
  if (path === "/m" || path.startsWith("/m/")) {
    // Bare /m → menu (not WorkerDailyHome) so managers do not land on check-in
    const rest = path === "/m" ? "/menu" : path.slice(2); // "/m/foo" → "/foo"
    return <Navigate to={`/app/worker${rest}${loc.search}${loc.hash}`} replace />;
  }
  // Absolute admin legacy (e.g. /work-permits/x) → /app/admin/...
  return <Navigate to={`/app/admin${path}${loc.search}${loc.hash}`} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <SystemRealtimeProvider>
            <Suspense fallback={<PageFallback />}>
              <Routes>
                <Route path="/landing" element={<Index />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/auth" element={<AuthRoute />} />
                <Route path="/login" element={<AuthRoute />} />
                <Route path="/register" element={<AuthRoute />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/update-password" element={<UpdatePassword />} />
                <Route path="/reset-password" element={<UpdatePassword />} />
                <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
                <Route path="/tbm/:token" element={<TbmParticipate />} />
                <Route path="/worker/register" element={<WorkerRegister />} />
                <Route path="/worker" element={<WorkerEntry />} />
                <Route path="/worker/portal/:token" element={<WorkerPortal />} />
                <Route path="/health/survey/:token" element={<HazardSurveyResponse />} />
                <Route path="/z/:code" element={<ZoneCheckin />} />
                <Route path="/c/:token" element={<CompanyScan />} />
                <Route path="/manual" element={<Manual />} />
                <Route path="/consent" element={<ConsentPage />} />
                <Route path="/onboarding" element={<Navigate to="/consent" replace />} />

                {/* Canonical role-split shells */}
                <Route path="/app/worker/*" element={<WorkerAppRoutes />} />
                <Route path="/app/admin/*" element={<AdminAppRoutes />} />

                {/* Legacy aliases → canonical */}
                <Route path="/m/*" element={<LegacyPathRedirect />} />
                <Route path="/*" element={<LegacyPathRedirect />} />
              </Routes>
            </Suspense>
            <MobileRedirectGuard />
            <InstallPrompt />
            <OfflineSyncMount />
          </SystemRealtimeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

function OfflineSyncMount() {
  useOfflineSync();
  return null;
}

function RoleAwareRootRedirect() {
  const { user, isAuthLoading, roles, rolesReady, profile } = useAuth();
  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        세션 확인 중…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!rolesReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        세션 확인 중…
      </div>
    );
  }
  const dest = postLoginPath(roles, profile, { rolesReady });
  // Never Navigate to "/" (would re-enter this redirect)
  if (!dest || dest === "/") return <Navigate to="/consent" replace />;
  return <Navigate to={dest} replace />;
}

export default App;
