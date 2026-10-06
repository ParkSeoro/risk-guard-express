import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import UserManagement from './UserManagement';

const SettingsPermissions = () => {
  const { hasRole } = useAuth();
  const canManagePermissions = hasRole('master') || hasRole('project_admin');

  if (!canManagePermissions) {
    return (
      <div className="space-y-4 animate-fade-in max-w-3xl">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" /> 권한 관리
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            마스터 또는 프로젝트 관리자 권한이 필요합니다.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2">
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>권한 관리</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" /> 권한 관리
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            마스터는 사람마다 역할·직책·업체를 지정합니다. 작업계획서·위험성평가 등 기능 권한은
            역할표로 정해지며, 개인별 기능 스위치는 없습니다.
          </p>
        </div>
      </div>
      <UserManagement />
    </div>
  );
};

export default SettingsPermissions;
