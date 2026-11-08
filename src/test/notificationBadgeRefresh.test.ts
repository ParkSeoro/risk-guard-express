import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  UNREAD_RECOUNT_DEBOUNCE_MS,
  createCoalescedCall,
  isApprovalRequestNotification,
  notificationBadgeRefreshKind,
} from "@/lib/notificationBadgeRefresh";

describe("notification badge refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recounts immediately on insert and once after a burst of updates", () => {
    expect(notificationBadgeRefreshKind("INSERT")).toBe("immediate");
    expect(notificationBadgeRefreshKind("UPDATE")).toBe("debounced");
    expect(notificationBadgeRefreshKind("DELETE")).toBe("debounced");

    vi.useFakeTimers();
    const run = vi.fn();
    const coalesced = createCoalescedCall(UNREAD_RECOUNT_DEBOUNCE_MS, run);
    coalesced.schedule();
    coalesced.schedule();
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNREAD_RECOUNT_DEBOUNCE_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats only an approval request as the approvals-badge event", () => {
    expect(isApprovalRequestNotification({ type: "approval_request" })).toBe(true);
    expect(isApprovalRequestNotification({ type: "approval_result" })).toBe(false);
    expect(isApprovalRequestNotification(null)).toBe(false);
  });

  it("matches the bell, the approvals hook, and the unread index to section 10", () => {
    const bell = readFileSync("src/components/NotificationBell.tsx", "utf8");
    const hook = readFileSync("src/hooks/usePendingApprovalsCount.ts", "utf8");
    const desktop = readFileSync("src/components/desktop/DesktopRailSidebar.tsx", "utf8");
    const index = readFileSync(
      "supabase/migrations/20261108110000_notifications_unread_user_index.sql",
      "utf8",
    );

    expect(bell).toContain("useSystemRealtimeOptional");
    expect(bell).toContain(".eq('user_id', user.id)");
    expect(bell).toContain(".eq('is_read', false)");
    expect(bell).not.toContain(".in('id', unreadIds)");
    expect(bell).toContain("if (open) void fetchNotifications()");

    expect(hook).toContain("isApprovalRequestNotification");
    expect(hook).toContain("count_my_pending_entity_approvals");
    expect(hook).not.toContain('table: "approvals"');

    expect(desktop).toContain("usePendingApprovalsCount()");
    expect(desktop).toContain("loadChatUnread");
    expect(desktop).not.toContain("loadBadges");

    expect(index).toContain("idx_notifications_user_unread");
    expect(index).toContain("WHERE is_read = false");
  });
});
