import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Bell, Save, Mail, MessageSquare, Smartphone } from 'lucide-react';

interface NotifPrefs {
  channel_email: boolean;
  channel_sms: boolean;
  channel_kakao: boolean;
  event_approval_request: boolean;
  event_approval_result: boolean;
  event_return_request: boolean;
  event_validation_complete: boolean;
  business_hours_only: boolean;
}

const defaults: NotifPrefs = {
  channel_email: true,
  channel_sms: false,
  channel_kakao: false,
  event_approval_request: true,
  event_approval_result: true,
  event_return_request: true,
  event_validation_complete: false,
  business_hours_only: false,
};

const SettingsNotifications = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [prefs, setPrefs] = useState<NotifPrefs>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const { data } = await supabase
        .from('notification_preferences' as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) {
        const d = data as any;
        setPrefs({
          channel_email: d.channel_email ?? true,
          channel_sms: d.channel_sms ?? false,
          channel_kakao: d.channel_kakao ?? false,
          event_approval_request: d.event_approval_request ?? true,
          event_approval_result: d.event_approval_result ?? true,
          event_return_request: d.event_return_request ?? true,
          event_validation_complete: d.event_validation_complete ?? false,
          business_hours_only: d.business_hours_only ?? false,
        });
      }
      setLoading(false);
    };
    fetch();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);

    // Upsert
    const { error } = await supabase
      .from('notification_preferences' as any)
      .upsert(
        { user_id: user.id, ...prefs, updated_at: new Date().toISOString() } as any,
        { onConflict: 'user_id' }
      );

    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '알림 설정이 저장되었습니다.' });
      log('알림설정변경', 'notification_preferences', user.id, undefined, prefs as any);
    }
    setSaving(false);
  };

  const toggle = (key: keyof NotifPrefs) => setPrefs(p => ({ ...p, [key]: !p[key] }));

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">로딩 중...</div>;
  }

  return (
    <div className="space-y-4 animate-fade-in max-w-2xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/settings')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>설정</span><span>/</span><span>알림 설정</span>
          </div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Bell className="h-5 w-5" /> 알림 설정
          </h1>
        </div>
      </div>

      {/* Channels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">수신 채널</CardTitle>
          <CardDescription className="text-xs">알림을 수신할 채널을 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">이메일</Label>
            </div>
            <Switch checked={prefs.channel_email} onCheckedChange={() => toggle('channel_email')} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">SMS</Label>
              <Badge variant="outline" className="text-[9px] text-muted-foreground">준비 중</Badge>
            </div>
            <Switch checked={prefs.channel_sms} onCheckedChange={() => toggle('channel_sms')} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">카카오 알림톡</Label>
              <Badge variant="outline" className="text-[9px] text-muted-foreground">준비 중</Badge>
            </div>
            <Switch checked={prefs.channel_kakao} onCheckedChange={() => toggle('channel_kakao')} />
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">수신 이벤트</CardTitle>
          <CardDescription className="text-xs">알림을 수신할 이벤트를 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">결재 상신 요청</Label>
            <Switch checked={prefs.event_approval_request} onCheckedChange={() => toggle('event_approval_request')} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">결재 승인/반려</Label>
            <Switch checked={prefs.event_approval_result} onCheckedChange={() => toggle('event_approval_result')} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">보완 요청/재제출</Label>
            <Switch checked={prefs.event_return_request} onCheckedChange={() => toggle('event_return_request')} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-sm">검증 완료/부적정 발생</Label>
            <Switch checked={prefs.event_validation_complete} onCheckedChange={() => toggle('event_validation_complete')} />
          </div>
        </CardContent>
      </Card>

      {/* Options */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">추가 옵션</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">업무시간만 수신</Label>
              <p className="text-[10px] text-muted-foreground">평일 09:00~18:00에만 알림을 수신합니다.</p>
            </div>
            <Switch checked={prefs.business_hours_only} onCheckedChange={() => toggle('business_hours_only')} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-1.5">
        <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '알림 설정 저장'}
      </Button>
    </div>
  );
};

export default SettingsNotifications;
