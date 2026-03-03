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
import { ArrowLeft, Bell, Save, Mail, MessageSquare, Smartphone, Send, CheckCircle2, XCircle, Clock } from 'lucide-react';

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
  channel_email: true, channel_sms: false, channel_kakao: false,
  event_approval_request: true, event_approval_result: true,
  event_return_request: true, event_validation_complete: false,
  business_hours_only: false,
};

interface EmailLogEntry {
  id: string;
  created_at: string;
  action: string;
  user_name: string;
  details: {
    to?: string;
    subject?: string;
    type?: string;
    email_sent?: boolean;
    error?: string;
    reason?: string;
  };
}

const SettingsNotifications = () => {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [prefs, setPrefs] = useState<NotifPrefs>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isMaster = hasRole('master');

  // Email log state
  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);

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

  const fetchEmailLogs = async () => {
    setLogsLoading(true);
    const { data } = await supabase
      .from('audit_logs')
      .select('id, created_at, action, user_name, details')
      .or('action.eq.email_notification_sent,action.eq.email_notification_failed,action.eq.email_notification_queued')
      .order('created_at', { ascending: false })
      .limit(100);
    setEmailLogs((data || []) as any);
    setLogsLoading(false);
  };

  const handleTestEmail = async () => {
    if (!user) return;
    setTestSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-notification-email', {
        body: {
          user_id: user.id,
          title: '테스트 이메일',
          message: '이 메일은 알림 시스템 테스트입니다. 정상 수신되면 이메일 발송이 작동하고 있습니다.',
          type: 'test',
        },
      });
      if (error) {
        toast({ title: '테스트 발송 실패', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '테스트 알림 전송됨', description: '인앱 알림이 생성되었습니다. 이메일 발송 결과는 로그를 확인하세요.' });
        if (showLogs) fetchEmailLogs();
      }
    } catch (err) {
      toast({ title: '테스트 발송 실패', description: String(err), variant: 'destructive' });
    }
    setTestSending(false);
  };

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

      {/* Debug Tools - Master Only */}
      {isMaster && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="h-4 w-4" /> 이메일 발송 진단 (마스터 전용)
              </CardTitle>
              <CardDescription className="text-xs">테스트 메일 발송 및 발송 로그를 확인합니다.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleTestEmail} disabled={testSending}>
                  <Send className="h-3 w-3" /> {testSending ? '발송 중...' : '테스트 메일 보내기'}
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchEmailLogs(); }}>
                  <Clock className="h-3 w-3" /> {showLogs ? '로그 숨기기' : '발송 로그 보기'}
                </Button>
              </div>

              {showLogs && (
                <div className="space-y-2">
                  {logsLoading ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">로그 로딩 중...</p>
                  ) : emailLogs.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">발송 로그가 없습니다.</p>
                  ) : (
                    <div className="max-h-64 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="text-left p-1.5">시간</th>
                            <th className="text-left p-1.5">수신자</th>
                            <th className="text-center p-1.5">결과</th>
                            <th className="text-left p-1.5">유형</th>
                            <th className="text-left p-1.5">사유</th>
                          </tr>
                        </thead>
                        <tbody>
                          {emailLogs.map(entry => {
                            const d = entry.details || {} as any;
                            const sent = d.email_sent === true;
                            return (
                              <tr key={entry.id} className="border-t">
                                <td className="p-1.5 text-muted-foreground whitespace-nowrap">
                                  {new Date(entry.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="p-1.5">{d.to || '—'}</td>
                                <td className="p-1.5 text-center">
                                  {sent ? <CheckCircle2 className="h-3.5 w-3.5 text-success inline" /> : <XCircle className="h-3.5 w-3.5 text-destructive inline" />}
                                </td>
                                <td className="p-1.5">{d.type || '—'}</td>
                                <td className="p-1.5 text-muted-foreground max-w-[200px] truncate">{d.error || d.reason || (sent ? '성공' : '—')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default SettingsNotifications;
