import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import { fetchChatUnreadTotal } from "@/lib/messengerApi";
import { MessengerDrawer } from "./MessengerDrawer";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { prefersMobileAppShell } from "@/hooks/use-mobile";
import { messengerHomePath } from "@/lib/messengerPath";
import { subscribeToPush } from "@/lib/pushSubscription";
import { Capacitor } from "@capacitor/core";

interface MessengerButtonProps {
  currentProjectId?: string | null;
  className?: string;
}

export function MessengerButton({ currentProjectId, className }: MessengerButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const refreshUnread = useCallback(async () => {
    if (!user) return;
    try {
      const count = await fetchChatUnreadTotal();
      setUnreadCount(count);
    } catch (err) {
      console.error("refreshUnread error:", err);
    }
  }, [user]);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  // 웹은 숫자 뱃지만으로는 부족하다. 권한을 받아 Windows 알림(서비스워커 푸시)으로 보낸다.
  useEffect(() => {
    if (!user) return;
    if (Capacitor?.isNativePlatform?.()) return;
    void subscribeToPush(user.id);
  }, [user]);

  // 실시간 메시지 변경 감지하여 미확인 카운트 즉시 갱신
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("messenger-button-unread")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chat_room_messages",
        },
        () => {
          refreshUnread();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_participants",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          refreshUnread();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, refreshUnread]);

  const handleClick = () => {
    // 폰은 /app/admin 으로 가면 MobileRedirectGuard 가 오늘 화면으로 되돌린다.
    if (prefersMobileAppShell()) {
      navigate(messengerHomePath({ mobileShell: true }));
      return;
    }
    setIsDrawerOpen(true);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className={cn("relative h-9 w-9 text-muted-foreground hover:text-foreground", className)}
        onClick={handleClick}
        title="SafeNex 메신저"
        aria-label="메신저 열기"
      >
        <MessageSquare className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-extrabold flex items-center justify-center border-2 border-background shadow-xs animate-in zoom-in-50">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      <MessengerDrawer
        isOpen={isDrawerOpen}
        onClose={() => {
          setIsDrawerOpen(false);
          refreshUnread();
        }}
        currentProjectId={currentProjectId}
      />
    </>
  );
}
