import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import AssessmentRuns from "./pages/AssessmentRuns";
import AssessmentRunDetail from "./pages/AssessmentRunDetail";
import MasterData from "./pages/MasterData";
import Approvals from "./pages/Approvals";
import Verification from "./pages/Verification";
import VerificationCenter from "./pages/VerificationCenter";
import ScheduleUpload from "./pages/ScheduleUpload";
import AuditLogs from "./pages/AuditLogs";
// TBM feature removed
import UserManagement from "./pages/UserManagement";
import PermissionTest from "./pages/PermissionTest";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading, profile } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">로딩 중...</div>;
  if (!user) return <Navigate to="/auth" replace />;

  if (profile && (profile as any).account_status === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="h-16 w-16 rounded-2xl bg-warning/20 flex items-center justify-center mx-auto">
            <span className="text-3xl">⏳</span>
          </div>
          <h2 className="text-xl font-bold">승인 대기 중</h2>
          <p className="text-sm text-muted-foreground">
            관리자가 계정을 승인한 후에 시스템을 이용하실 수 있습니다.<br />
            승인이 완료되면 새로고침 후 접근 가능합니다.
          </p>
          <button onClick={() => window.location.reload()} className="text-sm text-accent hover:underline">새로고침</button>
        </div>
      </div>
    );
  }

  if (profile && (profile as any).account_status === 'inactive') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <h2 className="text-xl font-bold text-destructive">계정 비활성화</h2>
          <p className="text-sm text-muted-foreground">계정이 비활성화되었습니다. 관리자에게 문의하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/risk-assessment" element={<AssessmentRuns />} />
        <Route path="/risk-assessment/:projectId" element={<AssessmentRuns />} />
        <Route path="/assessment-run/:runId" element={<AssessmentRunDetail />} />
        <Route path="/schedule-upload/:projectId" element={<ScheduleUpload />} />
        <Route path="/verification" element={<Verification />} />
        <Route path="/verification-center" element={<VerificationCenter />} />
        <Route path="/master-data" element={<MasterData />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/audit-logs" element={<AuditLogs />} />
        {/* TBM removed */}
        <Route path="/user-management" element={<UserManagement />} />
        <Route path="/permission-test" element={<PermissionTest />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<AuthRoute />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/*" element={<ProtectedRoutes />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

function AuthRoute() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <Auth />;
}

export default App;
