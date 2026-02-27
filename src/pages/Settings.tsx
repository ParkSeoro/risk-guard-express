import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Shield, Bell, ChevronRight, Settings as SettingsIcon } from 'lucide-react';

const settingsCards = [
  {
    id: 'account',
    title: '계정 정보',
    description: '이름, 이메일, 소속, 연락처 등 내 계정 정보를 수정합니다.',
    icon: User,
    path: '/settings/account',
    requiresAdmin: false,
  },
  {
    id: 'permissions',
    title: '권한 관리',
    description: '사용자 승인, 역할 부여, 접근 권한을 관리합니다.',
    icon: Shield,
    path: '/settings/permissions',
    requiresAdmin: true,
    badge: '마스터 전용',
  },
  {
    id: 'notifications',
    title: '알림 설정',
    description: '이메일, SMS, 카카오 알림 수신 채널과 이벤트를 설정합니다.',
    icon: Bell,
    path: '/settings/notifications',
    requiresAdmin: false,
  },
];

const Settings = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
          <span>DIG AIRGAS</span>
          <span>/</span>
          <span>위험성평가 시스템</span>
        </div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-6 w-6" /> 설정
        </h1>
        <p className="text-sm text-muted-foreground mt-1">시스템 계정, 권한, 알림을 관리합니다.</p>
      </div>

      <div className="grid gap-4">
        {settingsCards.map((card) => {
          const disabled = card.requiresAdmin && !isAdmin();
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
    </div>
  );
};

export default Settings;
