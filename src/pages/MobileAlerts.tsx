import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bell, CheckCheck, Settings } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";

export default function MobileAlerts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      (await import("sonner")).toast.error("알림 불러오기 실패: " + error.message);
      return;
    }
    setItems(data || []);
  };
  useEffect(() => {
    load();
  }, [user]);

  const handle = async (n: any) => {
    if (!n.is_read) await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    const route = resolveNotificationRoute(n, { mobileShell: true });
    if (route) navigate(route);
  };

  const markAll = async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    load();
  };

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-alerts">
      <MobilePageHeader
        title="알림"
        actions={
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => navigate("/app/worker/notifications")}
              title="알림 설정"
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={markAll}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" /> 모두 읽음
            </Button>
          </>
        }
      />
      <main className="px-4 pb-4 space-y-2">
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Bell className="h-10 w-10 mx-auto opacity-30" />
            <div className="mt-2 text-sm">알림이 없습니다</div>
          </div>
        )}
        {items.map((n) => (
          <Card key={n.id} className={!n.is_read ? "border-primary/50 bg-primary/5" : ""}>
            <CardContent className="pt-3 pb-3 cursor-pointer active:bg-muted" onClick={() => handle(n)}>
              <div className="flex justify-between items-start gap-2">
                <div className="font-semibold text-sm">{n.title}</div>
                {!n.is_read && <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">{n.message}</div>
              <div className="text-[10px] text-muted-foreground mt-1">
                {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ko })}
              </div>
            </CardContent>
          </Card>
        ))}
      </main>
    </div>
  );
}
