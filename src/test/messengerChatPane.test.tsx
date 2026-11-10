import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

if (typeof globalThis.DOMRect === "undefined") {
  class DOMRectPolyfill {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    left: number;
    right: number;
    bottom: number;
    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.left = x;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
    }
    static fromRect(rect?: { x?: number; y?: number; width?: number; height?: number }) {
      return new DOMRectPolyfill(rect?.x ?? 0, rect?.y ?? 0, rect?.width ?? 0, rect?.height ?? 0);
    }
    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    }
  }
  (globalThis as unknown as { DOMRect: typeof DOMRectPolyfill }).DOMRect = DOMRectPolyfill;
}

const {
  fetchRoomMessages,
  sendChatMessage,
  uploadChatFile,
  markChatRoomRead,
  setChatNotificationEnabled,
  touchChatRoomPresence,
  clearChatRoomPresence,
} = vi.hoisted(() => ({
  fetchRoomMessages: vi.fn(),
  sendChatMessage: vi.fn(),
  uploadChatFile: vi.fn(),
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

vi.mock("@/lib/messengerApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/messengerApi")>();
  return {
    ...actual,
    fetchRoomMessages: (...args: unknown[]) => fetchRoomMessages(...args),
    sendChatMessage: (...args: unknown[]) => sendChatMessage(...args),
    uploadChatFile: (...args: unknown[]) => uploadChatFile(...args),
    markChatRoomRead: (...args: unknown[]) => markChatRoomRead(...args),
    setChatNotificationEnabled: (...args: unknown[]) => setChatNotificationEnabled(...args),
    touchChatRoomPresence: (...args: unknown[]) => touchChatRoomPresence(...args),
    clearChatRoomPresence: (...args: unknown[]) => clearChatRoomPresence(...args),
  };
});

import { MessengerChatPane } from "@/components/messenger/MessengerChatPane";
import type { ChatRoom } from "@/lib/messengerApi";
import { readMessengerPickerState } from "@/lib/messengerPath";

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

  it("draws the read line before the first unread message and opens a labeled menu", async () => {
    fetchRoomMessages.mockResolvedValue({
      messages: [
        {
          id: "old",
          room_id: "room-1",
          sender_id: "other",
          parent_id: null,
          message_type: "TEXT",
          content: "어제 메시지",
          is_deleted: false,
          created_at: "2026-11-05T00:00:00.000Z",
          updated_at: "2026-11-05T00:00:00.000Z",
        },
        {
          id: "fresh",
          room_id: "room-1",
          sender_id: "other",
          parent_id: null,
          message_type: "TEXT",
          content: "오늘 메시지",
          is_deleted: false,
          created_at: "2026-11-06T00:00:00.000Z",
          updated_at: "2026-11-06T00:00:00.000Z",
        },
      ],
      hasMore: false,
    });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const roomWithRead = {
      ...room,
      participants: [
        {
          id: "p-me",
          room_id: "room-1",
          user_id: "me",
          room_name_override: null,
          is_notification_enabled: true,
          last_read_at: "2026-11-05T12:00:00.000Z",
          last_read_message_id: null,
          joined_at: "2026-11-01T00:00:00.000Z",
          left_at: null,
        },
      ],
    };
    await act(async () => {
      root!.render(<MessengerChatPane room={roomWithRead} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const text = document.body.textContent || "";
    const marker = text.indexOf("여기까지 읽었습니다");
    expect(text.indexOf("어제 메시지")).toBeLessThan(marker);
    expect(marker).toBeLessThan(text.indexOf("오늘 메시지"));

    const bubble = Array.from(document.querySelectorAll("div")).find((node) =>
      node.textContent === "오늘 메시지",
    );
    await act(async () => {
      bubble?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).not.toContain("답장");

    await act(async () => {
      bubble?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    });
    expect(document.body.textContent).toContain("답장");
    expect(document.body.textContent).toContain("복사");
    expect(document.body.textContent).toContain("전달");

    const input = document.querySelector("textarea");
    await act(async () => {
      input?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
    });
    expect(document.body.textContent).toContain("붙여넣기");
    expect(document.body.textContent).toContain("입력 지우기");
  });

  it("provides direct camera capture and file attachment buttons without duplicate gallery button", async () => {
    fetchRoomMessages.mockResolvedValue({ messages: [], hasMore: false });

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<MessengerChatPane room={room} />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const cameraBtn = host.querySelector("[aria-label='카메라 촬영']") as HTMLButtonElement;
    const fileBtn = host.querySelector("[aria-label='첨부파일']") as HTMLButtonElement;
    const duplicateGalleryBtn = host.querySelector("[aria-label='사진 올리기']");
    expect(cameraBtn).toBeTruthy();
    expect(fileBtn).toBeTruthy();
    expect(duplicateGalleryBtn).toBeNull();

    const inputs = Array.from(host.querySelectorAll("input[type='file']")) as HTMLInputElement[];
    expect(inputs.length).toBe(2);
    expect(inputs[0].getAttribute("accept")).toBe("image/*");
    expect(inputs[0].getAttribute("capture")).toBe("environment");

    await act(async () => {
      fileBtn.click();
    });
    expect(readMessengerPickerState()?.roomId).toBe("room-1");

    // Simulate capturing/selecting a photo and clicking Send (전송)
    uploadChatFile.mockResolvedValueOnce({
      fileName: "camera_test.jpg",
      fileSize: 1024,
      mimeType: "image/jpeg",
      publicUrl: "https://example.com/camera_test.jpg",
      isImage: true,
    });
    sendChatMessage.mockResolvedValueOnce({
      id: "msg-photo-1",
      room_id: "room-1",
      sender_id: "me",
      parent_id: null,
      message_type: "IMAGE",
      content: "사진을 보냈습니다.",
      is_deleted: false,
      created_at: "2026-11-10T03:00:00.000Z",
      updated_at: "2026-11-10T03:00:00.000Z",
      attachments: [
        {
          id: "att-1",
          message_id: "msg-photo-1",
          file_name: "camera_test.jpg",
          file_size: 1024,
          mime_type: "image/jpeg",
          storage_provider: "SUPABASE",
          gcs_bucket: "attachments",
          gcs_blob_name: "https://example.com/camera_test.jpg",
          public_url: "https://example.com/camera_test.jpg",
          thumbnail_url: "https://example.com/camera_test.jpg",
          created_at: "2026-11-10T03:00:00.000Z",
        },
      ],
      reactions: [],
    });

    const photoFile = new File(["img"], "camera_test.jpg", { type: "image/jpeg" });
    await act(async () => {
      Object.defineProperty(inputs[0], "files", {
        value: [photoFile],
        configurable: true,
      });
      inputs[0].dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(host.textContent).toContain("camera_test.jpg");

    const sendBtn = host.querySelector("button[title='전송']") as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    await act(async () => {
      sendBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(uploadChatFile).toHaveBeenCalledWith(photoFile, "room-1");
    expect(sendChatMessage).toHaveBeenCalled();
    expect(host.textContent).toContain("사진을 보냈습니다.");
    expect(host.querySelector("img[alt='camera_test.jpg']")).toBeTruthy();
  });
});
