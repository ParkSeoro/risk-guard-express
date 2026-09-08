import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Check, Inbox, Search, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import { notificationPreview, notificationTitle } from "@/lib/notificationText";
import { applyRevealedWorkStopName } from "@/lib/workStop";
import { fetchRevealedWorkStopNames, workStopIdsFromNotifications } from "@/lib/workStopReveal";

export default function NotificationInbox() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300);
    const rows = data || [];
    setItems(rows);
    const revealed = await fetchRevealedWorkStopNames(workStopIdsFromNotifications(rows));
    setNames(revealed);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const previewOf = (n: any) =>
    applyRevealedWorkStopName(notificationPreview(n), names[String(n.related_id || "")]);

  const unreadCount = useMemo(() => items.filter((n) => !n.is_read).length, [items]);
  const visible = useMemo(() => {
    const base = tab === "unread" ? items.filter((n) => !n.is_read) : items;
    const key = q.trim().toLowerCase();
    if (!key) return base;
    return base.filter((n) => {
      const title = notificationTitle(n).toLowerCase();
      const preview = previewOf(n).toLowerCase();
      return title.includes(key) || preview.includes(key);
    });
  }, [items, tab, q, names]);

  const markRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const openItem = async (n: any) => {
    if (!n.is_read) await markRead(n.id);
    const route = resolveNotificationRoute(n, { mobileShell: false });
    if (route) navigate(route);
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl" data-testid="notification-inbox">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="h-6 w-6" /> 알림
          </h1>
          <p className="text-sm text-muted-foreground">읽지 않은 알림 {unreadCount}건 · 최근 300건</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/app/admin/settings/notifications")}>
            <Settings className="h-4 w-4 mr-1" /> 알림 설정
          </Button>
          <Button variant="outline" size="sm" onClick={markAll} disabled={unreadCount === 0}>
            <Check className="h-4 w-4 mr-1" /> 모두 읽음
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "unread" | "all")}>
          <TabsList>
            <TabsTrigger value="unread">안읽음 ({unreadCount})</TabsTrigger>
            <TabsTrigger value="all">전체 ({items.length})</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8 h-9" placeholder="제목·내용 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground py-10 text-center">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <Inbox className="h-8 w-8 mx-auto opacity-40 mb-2" />
          {q ? "검색 결과가 없습니다." : tab === "unread" ? "읽지 않은 알림이 없습니다." : "알림이 없습니다."}
        </div>
      ) : (
        <div className="rounded-lg border divide-y bg-background">
          {visible.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`w-full text-left px-4 py-3 hover:bg-muted/40 ${!n.is_read ? "bg-primary/5" : ""}`}
              onClick={() => void openItem(n)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`text-sm ${!n.is_read ? "font-semibold" : ""}`}>{notificationTitle(n)}</div>
                {!n.is_read && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
              </div>
              {previewOf(n) && (
                <div className="text-xs text-muted-foreground mt-0.5 whitespace-pre-line">{previewOf(n)}</div>
              )}
              <div className="text-[11px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ko })}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
