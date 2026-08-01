import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Shield, Bell, Bot, ChevronRight, Settings as SettingsIcon, Smartphone, GitBranch, FileSignature, Building2, CloudSun } from 'lucide-react';
import { E2ETestAccountsSetup } from '@/components/E2ETestAccountsSetup';

const settingsCards = [
  {
    id: 'account',
    title: '계정 정보',
    description: '이름, 이메일, 소속, 연락처 등 내 계정 정보를 수정합니다.',
    icon: User,
    path: '/settings/account',
    requires: 'any' as const,
  },
  {
    id: 'permissions',
    title: '권한 관리',
    description: '사용자 승인, 역할 부여, 접근 권한을 관리합니다.',
    icon: Shield,
    path: '/settings/permissions',
    requires: 'admin' as const,
    badge: '관리자 전용',
  },
  {
    id: 'companies',
    title: '업체 관리 (시스템)',
    description: '시스템 전역 업체(시공사·협력사·발주처) 정보를 관리합니다. 여기서 등록된 업체는 프로젝트별로 참여 지정할 수 있습니다.',
    icon: Building2,
    path: '/settings/companies',
    requires: 'admin' as const,
    badge: '관리자 전용',
  },
  {
    id: 'approval-routes',
    title: '결재선 관리',
    description: '문서 유형별·회사별 기본 결재선 템플릿을 등록·관리합니다.',
    icon: GitBranch,
    path: '/settings/approval-routes',
    requires: 'admin' as const,
    badge: '관리자 전용',
  },
  {
    id: 'ai',
    title: 'AI 설정',
    description: 'AI API Key, 모델 선택, AI 사용 여부를 설정합니다.',
    icon: Bot,
    path: '/settings/ai',
    requires: 'master' as const,
    badge: '마스터 전용',
  },
  {
    id: 'weather',
    title: '현장 날씨 API',
    description: '기상청·OpenWeather API 키를 등록해 현장 주소 기반 날씨를 조회합니다.',
    icon: CloudSun,
    path: '/settings/weather',
    requires: 'master' as const,
    badge: '마스터 전용',
  },
  {
    id: 'notifications',
    title: '알림 설정',
    description: '이메일, SMS, 카카오 알림 수신 채널과 이벤트를 설정합니다.',
    icon: Bell,
    path: '/settings/notifications',
    requires: 'any' as const,
  },
  {
    id: 'mobile-releases',
    title: '모바일 앱 릴리스 (OTA)',
    description: 'iOS·Android 앱에 OTA 업데이트 번들을 게시·관리합니다.',
    icon: Smartphone,
    path: '/settings/mobile-releases',
    requires: 'master' as const,
    badge: '마스터 전용',
  },
  {
    id: 'permit-forms',
    title: '허가서 표시 양식',
    description: '회사별로 표준 허가서를 복제해 문구·항목 표시만 조정합니다. 같은 회사의 모든 프로젝트에 적용됩니다. 결재 규칙은 바뀌지 않습니다.',
    icon: FileSignature,
    path: '/settings/permit-forms',
    requires: 'master' as const,
    badge: '마스터 전용',
  },
];

const Settings = () => {
  const navigate = useNavigate();
  const { hasRole } = useAuth();

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          <span>안전관리시스템</span>
        </div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" /> 설정
        </h1>
        <p className="text-sm text-muted-foreground mt-1">시스템 계정, 권한, 알림을 관리합니다.</p>
      </div>

      <div className="grid gap-4">
        {settingsCards
          .filter((card) => card.requires !== 'master' || hasRole('master'))
          .map((card) => {
          const disabled =
            card.requires === 'master'
              ? !hasRole('master')
              : card.requires === 'admin'
                ? !(hasRole('master') || hasRole('project_admin') || hasRole('safety_manager'))
                : false;
          return (
            <Card
              key={card.id}
              className={`cursor-pointer transition-all hover:shadow-md hover:border-primary/30 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={() => !disabled && navigate(card.path)}
            >
              <CardContent className="flex items-center gap-4 py-5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <card.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{card.title}</CardTitle>
                    {card.badge && (
                      <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">
                        {card.badge}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs mt-0.5">{card.description}</CardDescription>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Master-only: E2E test account one-click setup. Rendered at the very bottom. */}
      <E2ETestAccountsSetup />
    </div>
  );
};

export default Settings;
