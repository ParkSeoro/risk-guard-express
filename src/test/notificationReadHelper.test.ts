import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  markNotificationAsRead,
  markRelatedNotificationsAsRead,
  markApprovalNotificationsAsRead,
  chatNotificationIdsCoveredByRead,
} from "@/lib/notificationReadHelper";
import { supabase } from "@/integrations/supabase/client";

vi.mock("@/integrations/supabase/client", () => {
  const updateMock = vi.fn().mockReturnThis();
  const eqMock = vi.fn().mockReturnThis();
  const fromMock = vi.fn().mockReturnValue({
    update: updateMock,
    eq: eqMock,
  });
  return {
    supabase: {
      from: fromMock,
    },
  };
});

describe("notificationReadHelper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks single notification as read by id", async () => {
    await markNotificationAsRead("notif-123");
    expect(supabase.from).toHaveBeenCalledWith("notifications");
  });

  it("ignores empty id safely", async () => {
    await markNotificationAsRead("");
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("keeps a messenger row that arrived after the room was read", () => {
    const rows = [
      {
        id: "old",
        type: "chat_message",
        related_id: "room-1",
        created_at: "2026-11-09T00:00:00.000Z",
        is_read: false,
      },
      {
        id: "new",
        type: "chat_message",
        related_id: "room-1",
        created_at: "2026-11-09T02:00:00.000Z",
        is_read: false,
      },
      {
        id: "other-room",
        type: "chat_message",
        related_id: "room-2",
        created_at: "2026-11-09T00:00:00.000Z",
        is_read: false,
      },
      {
        id: "permit",
        type: "work_permit",
        related_id: "room-1",
        created_at: "2026-11-09T00:00:00.000Z",
        is_read: false,
      },
    ];
    expect(chatNotificationIdsCoveredByRead(rows, [
      { roomId: "room-1", lastReadAt: "2026-11-09T01:00:00.000Z" },
    ])).toEqual(["old"]);
  });

  it("marks related notifications as read by user and entity id", async () => {
    await markRelatedNotificationsAsRead("user-1", "doc-999");
    expect(supabase.from).toHaveBeenCalledWith("notifications");
  });

  it("marks all approval request notifications as read for user", async () => {
    await markApprovalNotificationsAsRead("user-1");
    expect(supabase.from).toHaveBeenCalledWith("notifications");
  });
});
