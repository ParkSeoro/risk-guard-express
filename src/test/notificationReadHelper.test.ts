import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  markNotificationAsRead,
  markRelatedNotificationsAsRead,
  markApprovalNotificationsAsRead,
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

  it("marks related notifications as read by user and entity id", async () => {
    await markRelatedNotificationsAsRead("user-1", "doc-999");
    expect(supabase.from).toHaveBeenCalledWith("notifications");
  });

  it("marks all approval request notifications as read for user", async () => {
    await markApprovalNotificationsAsRead("user-1");
    expect(supabase.from).toHaveBeenCalledWith("notifications");
  });
});
