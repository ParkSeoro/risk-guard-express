import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Bell, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";

export default function MobileAlerts() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("notifications").select("*")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
    setItems(data || []);
  };
  useEffect(() => { load(); }, [user]);

  const handle = async (n: any) => {
    if (!n.is_read) await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    if (n.related_type === "safety_inspection") navigate("/safety-inspections");
    else if (n.related_type === "approval") navigate("/approvals");
    else if (n.related_type === "assessment_run" && n.related_id) navigate(`/assessment-run/${n.related_id}`);
  };

  const markAll = async () => {
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    load();
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">알림</div>
        <Button size="sm" variant="ghost" className="text-primary-foreground" onClick={markAll}>
          <CheckCheck className="h-4 w-4 mr-1" /> 모두 읽음
        </Button>
      </header>
      <main className="p-4 space-y-2 max-w-md mx-auto">
        {items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Bell className="h-10 w-10 mx-auto opacity-30" />
            <div className="mt-2 text-sm">알림이 없습니다</div>
          </div>
        )}
        {items.map(n => (
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
