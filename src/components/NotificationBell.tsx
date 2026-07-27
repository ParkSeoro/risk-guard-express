import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bell, Check, Settings as SettingsIcon, Inbox } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

// related_type → 라우트 매핑 (SSOT)
const ROUTE_MAP: Record<string, (id?: string) => string> = {
  assessment_run: (id) => (id ? `/assessment-run/${id}` : '/assessment-runs'),
  approval: () => '/approvals',
  work_permit: (id) => (id ? `/work-permits/${id}` : '/work-permits'),
  work_plan: (id) => (id ? `/work-plans/${id}` : '/work-plans'),
  safety_inspection: () => '/safety-inspections',
  incident_report: () => '/incidents',
  emergency_drill: () => '/emergency-drills',
  todo: () => '/todo',
  work_stop: () => '/work-stop',
  safety_cost_report: () => '/safety-cost',
  education: () => '/worker-education',
  worker: () => '/workers',
  chemical: () => '/health/chemicals',
};

const resolveRoute = (n: any): string | null => {
  const fn = ROUTE_MAP[n.related_type];
  return fn ? fn(n.related_id) : null;
};

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);
    setNotifications(data || []);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    if (!user) return;

    // Realtime: 새 알림 push
    const channel = supabase
      .channel(`notif-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => fetchNotifications(),
      )
      .subscribe();

    // 폴백 폴링 (realtime 끊김 대비)
    const interval = setInterval(fetchNotifications, 60_000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [user, fetchNotifications]);

  const unreadCount = useMemo(() => notifications.filter(n => !n.is_read).length, [notifications]);
  const visible = useMemo(
    () => (tab === 'unread' ? notifications.filter(n => !n.is_read) : notifications),
    [notifications, tab],
  );

  const markRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  const handleClick = (n: any) => {
    markRead(n.id);
    const route = resolveRoute(n);
    if (route) {
      navigate(route);
      setOpen(false);
    }
  };

  if (!user) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" aria-label={`알림 ${unreadCount}건`}>
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 bg-destructive text-destructive-foreground text-[10px] rounded-full flex items-center justify-center font-bold">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">알림 {unreadCount > 0 && <span className="text-destructive">({unreadCount})</span>}</span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
                <Check className="h-3 w-3" /> 모두 읽음
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => { navigate('/settings/notifications'); setOpen(false); }}
              aria-label="알림 설정"
            >
              <SettingsIcon className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="px-2 pt-2">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'all')}>
            <TabsList className="grid grid-cols-2 h-8">
              <TabsTrigger value="unread" className="text-xs">안읽음 ({unreadCount})</TabsTrigger>
              <TabsTrigger value="all" className="text-xs">전체 ({notifications.length})</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <ScrollArea className="max-h-80">
          {visible.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
              <Inbox className="h-6 w-6 opacity-40" />
              {tab === 'unread' ? '읽지 않은 알림이 없습니다.' : '알림이 없습니다.'}
            </div>
          ) : (
            visible.map(n => {
              const hasLink = !!resolveRoute(n);
              return (
                <div
                  key={n.id}
                  className={`px-3 py-2 border-b last:border-0 ${hasLink ? 'cursor-pointer' : ''} hover:bg-accent/10 transition-colors ${!n.is_read ? 'bg-primary/5' : ''}`}
                  onClick={() => handleClick(n)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${!n.is_read ? 'font-semibold' : ''}`}>{n.title}</p>
                      {n.message && <p className="text-[11px] text-muted-foreground line-clamp-2">{n.message}</p>}
                    </div>
                    {!n.is_read && <div className="h-2 w-2 rounded-full bg-primary shrink-0 mt-1" />}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ko })}
                  </p>
                </div>
              );
            })
          )}
        </ScrollArea>

        <div className="border-t px-3 py-2 text-right">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => { navigate('/mobile/alerts'); setOpen(false); }}
          >
            전체 보기 →
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
