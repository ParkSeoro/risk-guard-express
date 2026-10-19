import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Shield } from 'lucide-react';
import UserManagement from './UserManagement';
import { supabase } from '@/integrations/supabase/client';
import {
  isClientOwnerSmAnywhere,
  type OwnerSmMembershipLike,
} from '@/lib/signupApproval';

const SettingsPermissions = () => {
  const { hasRole, user } = useAuth();
  const [ownerSmMemberships, setOwnerSmMemberships] = useState<OwnerSmMembershipLike[] | null>(null);

  useEffect(() => {
    if (!user?.id) {
      setOwnerSmMemberships([]);
      return;
    }
    let cancelled = false;
    void supabase
      .from('project_members')
      .select('project_id, position_new, companies:company_id(type)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        if (cancelled) return;
        setOwnerSmMemberships(
          (data || []).map((m: any) => ({
            project_id: m.project_id,
            position_new: m.position_new,
            company_type: m.companies?.type ?? null,
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isOwnerSm = isClientOwnerSmAnywhere(ownerSmMemberships || []);
  const canManagePermissions =
    hasRole('master') || hasRole('project_admin') || isOwnerSm;

  if (ownerSmMemberships === null) {
    return (
      <div className="space-y-4 animate-fade-in max-w-3xl">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" /> 권한 관리
          </h1>
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            권한을 확인하는 중…
          </CardContent>
        </Card>
      </div>
    );
  }

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
            마스터, 프로젝트 관리자 또는 발주처 SM 권한이 필요합니다.
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
            관리자 가입 승인은 해당 프로젝트 발주처 SM(또는 마스터)만 할 수 있습니다.
            역할·직책·업체 지정은 마스터·프로젝트 관리자가 담당합니다.
          </p>
        </div>
      </div>
      <UserManagement />
    </div>
  );
};

export default SettingsPermissions;
