/**
 * Always-visible 현장 공지 strip for mobile Today home.
 * Pending ack banners/modals stay separate; this is the browse feed.
 */
import { Link } from "react-router-dom";
import { Megaphone, ChevronRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ko } from "date-fns/locale";
import {
  useMyFieldAnnouncements,
  type FieldAnnouncement,
} from "@/hooks/useMyFieldAnnouncements";
import { Badge } from "@/components/ui/badge";

const PREVIEW = 3;

export default function TodayFieldAnnouncements({
  projectId,
}: {
  projectId?: string | null;
}) {
  const { items, unread, loading } = useMyFieldAnnouncements(projectId, 10);
  const preview = items.slice(0, PREVIEW);
  const unreadCount = unread.length;

  return (
    <section
      className="rounded-xl border bg-background overflow-hidden"
      data-testid="today-field-announcements"
    >
      <div className="px-3 py-2.5 flex items-center justify-between gap-2 border-b">
        <div className="flex items-center gap-1.5 min-w-0">
          <Megaphone className="h-3.5 w-3.5 text-amber-600 shrink-0" />
          <span className="text-sm font-semibold truncate">현장 공지</span>
          {unreadCount > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] shrink-0">
              미확인 {unreadCount}
            </Badge>
          )}
        </div>
        <Link
          to="/app/worker/announcements"
          className="text-[11px] text-muted-foreground flex items-center gap-0.5 shrink-0 hover:text-foreground"
        >
          전체
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {loading && items.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">불러오는 중…</p>
      )}

      {!loading && items.length === 0 && (
        <p className="px-3 py-3 text-xs text-muted-foreground">받은 공지가 없습니다</p>
      )}

      {preview.length > 0 && (
        <ul className="divide-y">
          {preview.map((a) => (
            <li key={a.id}>
              <Link
                to={`/app/worker/announcements?id=${a.id}`}
                className="block px-3 py-2.5 hover:bg-muted/40 transition-colors"
              >
                <AnnouncementRow item={a} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AnnouncementRow({ item }: { item: FieldAnnouncement }) {
  const pending = !item.acked_at;
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="flex items-start gap-2">
        {pending && (
          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden />
        )}
        <p className={`text-sm leading-snug truncate ${pending ? "font-semibold" : "font-medium"}`}>
          {item.title}
        </p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pl-[14px]">
        {item.require_ack && <span>필독</span>}
        <span>
          {formatDistanceToNow(new Date(item.published_at), { addSuffix: true, locale: ko })}
        </span>
        {pending ? <span className="text-amber-700 dark:text-amber-400">미확인</span> : <span>확인함</span>}
      </div>
    </div>
  );
}
