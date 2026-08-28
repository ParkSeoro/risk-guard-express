import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { isPureWorkerUser } from '@/components/AuthGuard';
import { useToast } from '@/hooks/use-toast';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Bell, Save, Mail, MessageSquare, Smartphone, Send,
  CheckCircle2, XCircle, Clock, BellRing, Lock, AlertTriangle,
} from 'lucide-react';
import { isPushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/pushSubscription';
import { isNativeApp } from '@/lib/native/isNativeApp';
import { Capacitor } from '@capacitor/core';

interface NotifPrefs {
  // 채널
  channel_push: boolean;
  channel_in_app: boolean;
  channel_email: boolean;
  channel_sms: boolean;
  channel_kakao: boolean;
  // 이벤트 (사용자 토글)
  event_return_request: boolean;
  event_validation_complete: boolean;
  event_safety_inspection: boolean;
  event_work_permit: boolean;
  event_tbm: boolean;
  event_health_warning: boolean;
  event_health_checkup_due: boolean;
  event_todo_due: boolean;
  event_assessment_result: boolean;
  event_general: boolean;
  // 옵션
  business_hours_only: boolean;
  push_quiet_start: string | null;
  push_quiet_end: string | null;
}

const defaults: NotifPrefs = {
  channel_push: true, channel_in_app: true, channel_email: true,
  channel_sms: false, channel_kakao: false,
  event_return_request: true, event_validation_complete: false,
  event_safety_inspection: true, event_work_permit: true, event_tbm: false,
  event_health_warning: true, event_health_checkup_due: true,
  event_todo_due: true, event_assessment_result: false, event_general: true,
  business_hours_only: false, push_quiet_start: '22:00', push_quiet_end: '07:00',
};

// 시스템 강제(끌 수 없음) 이벤트 — DB의 should_push_notify와 동기화
const MANDATORY_EVENTS_ALL = [
  { key: 'incident',           label: '중대재해 / 사고 보고',   desc: '안전관리책임자에게 즉시 전달', worker: false },
  { key: 'approval_request',   label: '결재 상신 요청',         desc: '결재선 지정 결재자에게 전달 (일반 알림 채널)', worker: false },
  { key: 'approval_result',    label: '결재 승인 / 반려',       desc: '기안자·이미 결재한 단계에 결과 전달 (미도달 윗단계는 제외)', worker: false },
  { key: 'danger_zone_entry',  label: '위험구역 진입',         desc: '지오펜스 경보 (사이렌 채널)', worker: true },
  { key: 'work_stop',          label: '작업중지 요청',         desc: '긴급 작업중지 알림', worker: true },
  { key: 'announcement',       label: '현장 공지',             desc: '관리자가 게시한 현장 공지 (끌 수 없음)', worker: true },
] as const;

interface EmailLogEntry {
  id: string; created_at: string; action: string; user_name: string;
  details: { to?: string; subject?: string; type?: string; email_sent?: boolean; error?: string; reason?: string };
}

const SettingsNotifications = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasRole, roles } = useAuth();
  const { toast } = useToast();
  const { log } = useAuditLog();
  const [prefs, setPrefs] = useState<NotifPrefs>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isMaster = hasRole('master');
  const pureWorker = isPureWorkerUser(roles || []);
  const isMobileShell = location.pathname.startsWith('/app/worker');
  const native = isNativeApp();

  // 푸시 상태
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported' | 'granted' | 'denied' | 'prompt'>('default');
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [nativeToken, setNativeToken] = useState<{ platform: string; last_used_at: string | null } | null>(null);

  // 이메일 로그
  const [emailLogs, setEmailLogs] = useState<EmailLogEntry[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const refreshNativeToken = async (uid: string) => {
    const { data } = await supabase
      .from('device_push_tokens' as any)
      .select('platform, last_used_at, token')
      .eq('user_id', uid)
      .order('last_used_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setNativeToken({
        platform: (data as any).platform || Capacitor.getPlatform(),
        last_used_at: (data as any).last_used_at || null,
      });
      setPushSubscribed(true);
    } else {
      setNativeToken(null);
      if (native) setPushSubscribed(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('notification_preferences' as any).select('*').eq('user_id', user.id).maybeSingle();
      if (data) {
        const d = data as any;
        setPrefs({ ...defaults, ...d });
      }

      if (native) {
        try {
          const mod: any = await import('@capacitor/push-notifications');
          const perm = await mod.PushNotifications.checkPermissions();
          setPushPermission(perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'prompt');
        } catch {
          setPushPermission('unsupported');
        }
        await refreshNativeToken(user.id);
      } else if (!isPushSupported()) {
        setPushPermission('unsupported');
      } else {
        setPushPermission(Notification.permission);
        navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription())
          .then(sub => setPushSubscribed(!!sub))
          .catch(() => setPushSubscribed(false));
      }
      setLoading(false);
    })();
  }, [user, native]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('notification_preferences' as any)
      .upsert({ user_id: user.id, ...prefs, updated_at: new Date().toISOString() } as any, { onConflict: 'user_id' });
    if (error) {
      toast({ title: '저장 실패', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '알림 설정이 저장되었습니다.' });
      log('알림설정변경', 'notification_preferences', user.id, undefined, prefs as any);
    }
    setSaving(false);
  };

  const toggle = (key: keyof NotifPrefs) => setPrefs(p => ({ ...p, [key]: !p[key] }));
  const setField = <K extends keyof NotifPrefs>(key: K, v: NotifPrefs[K]) => setPrefs(p => ({ ...p, [key]: v }));

  const handleEnablePush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      if (native) {
        const mod: any = await import('@capacitor/push-notifications');
        const PushNotifications = mod.PushNotifications;
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive !== 'granted') {
          perm = await PushNotifications.requestPermissions();
        }
        if (perm.receive !== 'granted') {
          setPushPermission('denied');
          toast({
            title: '알림 권한이 필요합니다',
            description: '기기 설정 → 앱 → 알림을 허용한 뒤 다시 시도하세요.',
            variant: 'destructive',
          });
          return;
        }
        setPushPermission('granted');
        await PushNotifications.register();
        setPrefs((p) => ({ ...p, channel_push: true }));
        // registration listener in PushNotificationBridge upserts token; refresh shortly
        setTimeout(() => { void refreshNativeToken(user.id); }, 1500);
        toast({ title: '앱 푸시가 활성화되었습니다.', description: '결재·경보 알림을 받을 수 있습니다.' });
      } else {
        const r = await subscribeToPush(user.id);
        if (r.ok) {
          setPushPermission('granted');
          setPushSubscribed(true);
          setPrefs((p) => ({ ...p, channel_push: true }));
          toast({ title: '브라우저 푸시 알림이 활성화되었습니다.' });
        } else {
          const map: Record<string, string> = {
            unsupported: '이 브라우저는 푸시 알림을 지원하지 않습니다.',
            denied: '브라우저에서 알림 권한이 거부되어 있습니다. 브라우저 설정에서 허용해주세요.',
            no_sw: 'Service Worker 등록에 실패했습니다. (운영 환경에서만 작동)',
          };
          toast({ title: '푸시 활성화 실패', description: map[r.reason ?? ''] ?? r.reason, variant: 'destructive' });
        }
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (native) {
      toast({
        title: '앱 알림 해제',
        description: '기기 설정에서 SafeNex 알림을 끄면 푸시가 중단됩니다.',
      });
      return;
    }
    setPushBusy(true);
    await unsubscribeFromPush();
    setPushBusy(false);
    setPushSubscribed(false);
    toast({ title: '브라우저 푸시 알림이 해제되었습니다.' });
  };

  const handleTestPush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      if (native) {
        // Hits the same notifications → dispatch-notification-push → FCM path as real approvals
        const { error } = await supabase.from('notifications').insert({
          user_id: user.id,
          title: '테스트 푸시 (결재 경로)',
          message: 'SafeNex 앱 푸시가 정상 작동합니다. 결재 알림도 이 경로로 옵니다.',
          type: 'approval_request',
          link: '/app/worker/approvals',
          related_type: 'test',
        } as any);
        if (error) throw error;
        toast({
          title: '테스트 푸시 전송됨',
          description: nativeToken
            ? '잠시 후 알림이 표시됩니다.'
            : 'FCM 토큰이 없습니다. 위에서 「푸시 켜기」를 먼저 실행하세요.',
        });
      } else {
        const { error } = await supabase.functions.invoke('send-push', {
          body: {
            user_id: user.id,
            title: '테스트 푸시',
            body: '푸시 알림이 정상 작동합니다.',
            url: '/app/worker/alerts',
          },
        });
        if (error) throw error;
        toast({ title: '테스트 푸시 전송됨', description: '잠시 후 알림이 표시됩니다.' });
      }
    } catch (e: any) {
      toast({ title: '발송 실패', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setPushBusy(false);
    }
  };

  const fetchEmailLogs = async () => {
    setLogsLoading(true);
    const { data } = await supabase.from('audit_logs')
      .select('id, created_at, action, user_name, details')
      .or('action.eq.email_notification_sent,action.eq.email_notification_failed,action.eq.email_notification_queued')
      .order('created_at', { ascending: false }).limit(100);
    setEmailLogs((data || []) as any);
    setLogsLoading(false);
  };

  const handleTestEmail = async () => {
    if (!user) return;
    setTestSending(true);
    try {
      const { error } = await supabase.functions.invoke('send-notification-email', {
        body: { user_id: user.id, title: '테스트 이메일',
          message: '이 메일은 알림 시스템 테스트입니다.', type: 'test' },
      });
      if (error) toast({ title: '테스트 발송 실패', description: error.message, variant: 'destructive' });
      else { toast({ title: '테스트 알림 전송됨' }); if (showLogs) fetchEmailLogs(); }
    } catch (err) {
      toast({ title: '테스트 발송 실패', description: String(err), variant: 'destructive' });
    }
    setTestSending(false);
  };

  if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">로딩 중...</div>;

  // 사용자 토글 가능 이벤트 (근로자는 결재·검증·관리자용 항목 숨김)
  const userEvents: { key: keyof NotifPrefs; label: string; desc: string }[] = pureWorker
    ? [
        { key: 'event_work_permit',         label: '작업허가서',            desc: '배정된 작업허가·현장 안내' },
        { key: 'event_tbm',                 label: 'TBM 세션',              desc: 'TBM 시작 알림 및 참여 요청' },
        { key: 'event_health_warning',      label: '건강 이상 안내',         desc: '일일 건강일지·이상소견 관련 안내' },
        { key: 'event_assessment_result',   label: '위험성평가 결과 공유',    desc: '평가 완료 시 참가자에게' },
        { key: 'event_general',             label: '일반 공지',              desc: '시스템 공지 / 운영 안내' },
      ]
    : [
        { key: 'event_return_request',      label: '보완 요청 / 재제출',     desc: '결재 보완 요청을 받았을 때' },
        { key: 'event_validation_complete', label: '검증 완료 / 부적정',     desc: '데이터 검증 결과 통지' },
        { key: 'event_safety_inspection',   label: '안전점검 지적사항',      desc: '점검 부적합 및 조치 요청' },
        { key: 'event_work_permit',         label: '작업허가서',            desc: '작업허가 요청·승인·만료' },
        { key: 'event_tbm',                 label: 'TBM 세션',              desc: 'TBM 시작 알림 및 참여 요청' },
        { key: 'event_health_warning',      label: '건강 경고 (유소견·미수검 출근)', desc: '안전관리자에게 출근 경고' },
        { key: 'event_health_checkup_due',  label: '건강검진 도래 / 만료',   desc: '대상자·관리자에게 사전 통지' },
        { key: 'event_todo_due',            label: '할 일 마감 임박',        desc: '법정 의무 작업 마감 알림' },
        { key: 'event_assessment_result',   label: '위험성평가 결과 공유',    desc: '평가 완료 시 참가자에게' },
        { key: 'event_general',             label: '일반 공지',              desc: '시스템 공지 / 운영 안내' },
      ];

  const mandatoryEvents = pureWorker
    ? MANDATORY_EVENTS_ALL.filter((e) => e.worker)
    : MANDATORY_EVENTS_ALL;

  return (
    <div className={`space-y-4 animate-fade-in ${isMobileShell ? 'max-w-md mx-auto p-4 pb-24' : 'max-w-2xl'}`}>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => navigate(isMobileShell ? '/app/worker/more' : '/settings')}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          {!isMobileShell && (
            <div className="flex items-center gap-2 text-muted-foreground text-xs">
              <span>설정</span><span>/</span><span>알림 설정</span>
            </div>
          )}
          <h1 className="text-xl font-bold flex items-center gap-2"><Bell className="h-5 w-5" /> 알림 · 알람 설정</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            어떤 기능 알림을 받을지 선택하고, 앱 푸시가 켜져 있는지 확인합니다.
          </p>
        </div>
      </div>

      {/* 휴대폰 푸시 카드 — 가장 중요 */}
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <BellRing className="h-4 w-4 text-primary" /> {native ? '앱 푸시 알림 (FCM)' : '휴대폰 푸시 알림'}
          </CardTitle>
          <CardDescription className="text-xs">
            {native
              ? '앱을 닫아도 알림창으로 결재·경보를 받습니다. 권한이 꺼져 있으면 결재가 와도 푸시가 오지 않습니다.'
              : '앱을 닫아도 알림창으로 받을 수 있습니다. iOS는 홈 화면 추가 후 활성화하세요(iOS 16.4+).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pushPermission === 'unsupported' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">이 환경은 푸시 알림을 지원하지 않습니다.</AlertDescription>
            </Alert>
          )}
          {pushPermission === 'denied' && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                {native
                  ? '기기 설정에서 SafeNex 알림 권한이 거부되어 있습니다. 허용 후 「푸시 켜기」를 다시 누르세요.'
                  : '브라우저 설정에서 이 사이트의 알림 권한이 거부되어 있습니다. 권한 허용 후 다시 시도하세요.'}
              </AlertDescription>
            </Alert>
          )}
          {native && pushPermission === 'granted' && !nativeToken && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                알림 권한은 허용됐지만 FCM 토큰이 없습니다. 「푸시 켜기」로 재등록하세요. (Play 빌드·google-services 확인)
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <p className="text-sm font-medium flex items-center gap-1.5">
                {(native ? !!nativeToken : pushSubscribed)
                  ? <CheckCircle2 className="h-4 w-4 text-success" />
                  : <XCircle className="h-4 w-4 text-muted-foreground" />}
                {(native ? !!nativeToken : pushSubscribed) ? '활성화됨' : '비활성'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                권한: {pushPermission}
                {native && nativeToken
                  ? ` · ${nativeToken.platform}${nativeToken.last_used_at ? ` · ${new Date(nativeToken.last_used_at).toLocaleString('ko-KR')}` : ''}`
                  : ''}
              </p>
            </div>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={handleEnablePush}
                disabled={pushBusy || pushPermission === 'unsupported'}
                className="text-xs"
                variant={(native ? !!nativeToken : pushSubscribed) ? 'outline' : 'default'}
              >
                {(native ? !!nativeToken : pushSubscribed) ? '다시 등록' : '푸시 켜기'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleTestPush} disabled={pushBusy} className="text-xs gap-1">
                <Send className="h-3 w-3" /> 테스트
              </Button>
              {!native && pushSubscribed && (
                <Button size="sm" variant="ghost" onClick={handleDisablePush} disabled={pushBusy} className="text-xs">
                  해제
                </Button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">
            결재 알림은 <strong>일반 알림</strong> 채널입니다. 위험구역 진입만 사이렌(경보) 채널을 씁니다.
          </p>
        </CardContent>
      </Card>

      {/* 채널 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">수신 채널</CardTitle>
          <CardDescription className="text-xs">알림을 받을 채널을 선택합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><BellRing className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">{native ? '앱 푸시 (닫혀도 옴)' : '브라우저 푸시 (앱 닫혀도 옴)'}</Label>
            </div>
            <Switch checked={prefs.channel_push} onCheckedChange={() => toggle('channel_push')} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">앱 내 알림</Label>
            </div>
            <Switch checked={prefs.channel_in_app} onCheckedChange={() => toggle('channel_in_app')} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">이메일</Label>
            </div>
            <Switch checked={prefs.channel_email} onCheckedChange={() => toggle('channel_email')} />
          </div>
          <div className="flex items-center justify-between opacity-60">
            <div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">SMS</Label>
              <Badge variant="outline" className="text-[9px]">미사용</Badge>
            </div>
            <Switch checked={prefs.channel_sms} onCheckedChange={() => toggle('channel_sms')} disabled />
          </div>
          <div className="flex items-center justify-between opacity-60">
            <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm">카카오 알림톡</Label>
              <Badge variant="outline" className="text-[9px]">미사용</Badge>
            </div>
            <Switch checked={prefs.channel_kakao} onCheckedChange={() => toggle('channel_kakao')} disabled />
          </div>
        </CardContent>
      </Card>

      {/* 시스템 강제 알림 */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="h-4 w-4 text-destructive" /> 시스템 필수 알림
          </CardTitle>
          <CardDescription className="text-xs">
            법령·안전상 반드시 받아야 하는 알림으로, 끌 수 없으며 방해금지 시간에도 발송됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {mandatoryEvents.map(e => (
            <div key={e.key} className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{e.label}</p>
                <p className="text-[10px] text-muted-foreground">{e.desc}</p>
              </div>
              <Badge variant="destructive" className="text-[9px] h-5 shrink-0">필수</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 사용자 선택 알림 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">사용자 선택 알림</CardTitle>
          <CardDescription className="text-xs">필요한 알림만 켜두세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {userEvents.map(e => (
            <div key={e.key} className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <Label className="text-sm cursor-pointer">{e.label}</Label>
                <p className="text-[10px] text-muted-foreground">{e.desc}</p>
              </div>
              <Switch checked={prefs[e.key] as boolean} onCheckedChange={() => toggle(e.key)} />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 옵션 */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">방해금지 시간</CardTitle>
          <CardDescription className="text-xs">이 시간대에는 필수 알림 외 푸시가 발송되지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Label className="text-[10px] text-muted-foreground">시작</Label>
              <Input type="time" value={prefs.push_quiet_start ?? ''} onChange={e => setField('push_quiet_start', e.target.value || null)} className="h-8 text-xs" />
            </div>
            <span className="text-muted-foreground pt-4">~</span>
            <div className="flex-1">
              <Label className="text-[10px] text-muted-foreground">종료</Label>
              <Input type="time" value={prefs.push_quiet_end ?? ''} onChange={e => setField('push_quiet_end', e.target.value || null)} className="h-8 text-xs" />
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <div>
              <Label className="text-sm">업무시간만 수신</Label>
              <p className="text-[10px] text-muted-foreground">평일 09:00~18:00에만 알림 수신</p>
            </div>
            <Switch checked={prefs.business_hours_only} onCheckedChange={() => toggle('business_hours_only')} />
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-1.5">
        <Save className="h-3.5 w-3.5" /> {saving ? '저장 중...' : '알림 설정 저장'}
      </Button>

      {/* 마스터 전용 진단 */}
      {isMaster && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4" /> 이메일 발송 진단 (마스터)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleTestEmail} disabled={testSending}>
                <Send className="h-3 w-3" /> {testSending ? '발송 중...' : '테스트 메일'}
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => { setShowLogs(!showLogs); if (!showLogs) fetchEmailLogs(); }}>
                <Clock className="h-3 w-3" /> {showLogs ? '로그 숨기기' : '발송 로그'}
              </Button>
            </div>
            {showLogs && (
              <div className="space-y-2">
                {logsLoading ? <p className="text-xs text-muted-foreground py-4 text-center">로그 로딩 중...</p>
                  : emailLogs.length === 0 ? <p className="text-xs text-muted-foreground py-4 text-center">발송 로그가 없습니다.</p>
                  : <div className="max-h-64 overflow-auto rounded border">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0"><tr>
                          <th className="text-left p-1.5">시간</th><th className="text-left p-1.5">수신자</th>
                          <th className="text-center p-1.5">결과</th><th className="text-left p-1.5">유형</th><th className="text-left p-1.5">사유</th>
                        </tr></thead>
                        <tbody>{emailLogs.map(entry => {
                          const d = entry.details || {} as any; const sent = d.email_sent === true;
                          return <tr key={entry.id} className="border-t">
                            <td className="p-1.5 text-muted-foreground whitespace-nowrap">{new Date(entry.created_at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                            <td className="p-1.5">{d.to || '—'}</td>
                            <td className="p-1.5 text-center">{sent ? <CheckCircle2 className="h-3.5 w-3.5 text-success inline" /> : <XCircle className="h-3.5 w-3.5 text-destructive inline" />}</td>
                            <td className="p-1.5">{d.type || '—'}</td>
                            <td className="p-1.5 text-muted-foreground max-w-[200px] truncate">{d.error || d.reason || (sent ? '성공' : '—')}</td>
                          </tr>;
                        })}</tbody>
                      </table>
                    </div>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SettingsNotifications;
