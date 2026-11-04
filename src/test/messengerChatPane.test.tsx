import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const { fetchRoomMessages, markChatRoomRead, setChatNotificationEnabled, touchChatRoomPresence, clearChatRoomPresence } = vi.hoisted(() => ({
  fetchRoomMessages: vi.fn(),
  markChatRoomRead: vi.fn(async () => undefined),
  setChatNotificationEnabled: vi.fn(async () => true),
  touchChatRoomPresence: vi.fn(async () => undefined),
  clearChatRoomPresence: vi.fn(async () => undefined),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "me" },
    profile: { display_name: "나", company: null, position: null },
  }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = () => {
    const api = {
      on: () => api,
      subscribe: () => api,
      send: () => undefined,
    };
    return api;
  };
  return {
    supabase: {
      channel,
      removeChannel: () => undefined,
    },
  };
});

vi.mock("@/lib/messengerApi", () => ({
  fetchRoomMessages: (...args: unknown[]) => fetchRoomMessages(...args),
  sendChatMessage: vi.fn(),
  uploadChatFile: vi.fn(),
  markChatRoomRead: (...args: unknown[]) => markChatRoomRead(...args),
  setChatNotificationEnabled: (...args: unknown[]) => setChatNotificationEnabled(...args),
  touchChatRoomPresence: (...args: unknown[]) => touchChatRoomPresence(...args),
  clearChatRoomPresence: (...args: unknown[]) => clearChatRoomPresence(...args),
}));

import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import type { ChatRoom } from "@/lib/messengerApi";

const room: ChatRoom = {
  id: "room-1",
  project_id: "project-1",
  name: "안전팀",
  is_group: false,
  created_by: "me",
  last_message_text: "안녕",
  last_message_at: "2026-11-04T00:00:00.000Z",
  last_message_sender_id: "me",
  pinned_message_id: null,
  created_at: "2026-11-04T00:00:00.000Z",
  updated_at: "2026-11-04T00:00:00.000Z",
  notifications_enabled: true,
};

describe("MessengerChatPane history and mute", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    Element.prototype.scrollIntoView = () => undefined;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    root = null;
    host = null;
    fetchRoomMessages.mockReset();
    setChatNotificationEnabled.mockReset();
    setChatNotificationEnabled.mockResolvedValue(true);
  });

  it("shows older history and a per-room mute control", async () => {
    fetchRoomMessages.mockResolvedValue({
      messages: [
        {
          id: "m1",
          room_id: "room-1",
          sender_id: "me",
          parent_id: null,
          message_type: "TEXT",
          content: "최근 메시지",
          is_deleted: false,
          created_at: "2026-11-04T02:00:00.000Z",
          updated_at: "2026-11-04T02:00:00.000Z",
        },
      ],
      hasMore: true,
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<MessengerChatPane room={room} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.textContent).toContain("최근 메시지");
    expect(host.textContent).toContain("이전 대화 보기");
    expect(host.textContent).toContain("읽음");
    expect(host.querySelector("[aria-label='이 방 알림 끄기']")).toBeTruthy();

    const olderButton = Array.from(host.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("이전 대화 보기"),
    );
    fetchRoomMessages.mockResolvedValueOnce({
      messages: [
        {
          id: "m0",
          room_id: "room-1",
          sender_id: "other",
          parent_id: null,
          message_type: "TEXT",
          content: "이전 메시지",
          is_deleted: false,
          created_at: "2026-11-03T02:00:00.000Z",
          updated_at: "2026-11-03T02:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    await act(async () => {
      olderButton?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchRoomMessages).toHaveBeenLastCalledWith("room-1", {
      before: { createdAt: "2026-11-04T02:00:00.000Z", id: "m1" },
    });
    expect(host.textContent).toContain("이전 메시지");
    expect(host.textContent).toContain("최근 메시지");

    const mute = host.querySelector("[aria-label='이 방 알림 끄기']") as HTMLButtonElement;
    await act(async () => {
      mute.click();
    });
    expect(setChatNotificationEnabled).toHaveBeenCalledWith("room-1", false);
  });
});
