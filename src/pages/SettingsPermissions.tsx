import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Shield } from 'lucide-react';
import UserManagement from './UserManagement';

const SettingsPermissions = () => {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const canManagePermissions = hasRole('master') || hasRole('project_admin');

  if (!canManagePermissions) {
    return (
      <div className="space-y-4 animate-fade-in max-w-3xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
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
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>권한 관리</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" /> 권한 관리
          </h1>
        </div>
      </div>
      <UserManagement />
    </div>
  );
};

export default SettingsPermissions;
