/** How a notifications realtime event updates the unread total. */
export const UNREAD_RECOUNT_DEBOUNCE_MS = 400;

export type BadgeRefreshKind = "immediate" | "debounced";

/**
 * A new row is counted at once.
 * Read-updates often arrive in a burst, so those share one recount.
 * There is no local decrement.
 */
export function notificationBadgeRefreshKind(
  eventType: string | null | undefined,
): BadgeRefreshKind {
  return eventType === "INSERT" ? "immediate" : "debounced";
}

export function isApprovalRequestNotification(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return (row as { type?: unknown }).type === "approval_request";
}

/** Collapse a burst of calls into the last one, after `waitMs`. */
export function createCoalescedCall(waitMs: number, run: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        run();
      }, waitMs);
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
