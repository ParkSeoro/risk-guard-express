import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/messenger/MessageBubble";
import type { ChatRoomMessage } from "@/lib/messengerApi";

if (typeof globalThis.DOMRect === "undefined" || typeof DOMRect.fromRect !== "function") {
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

const message: ChatRoomMessage = {
  id: "msg-1",
  room_id: "room-1",
  sender_id: "user-2",
  parent_id: null,
  message_type: "TEXT",
  content: "난간 확인 바랍니다",
  is_deleted: false,
  created_at: "2026-11-10T01:00:00.000Z",
  updated_at: "2026-11-10T01:00:00.000Z",
  sender_name: "김안전",
};

function openMenu() {
  fireEvent.contextMenu(screen.getByText("난간 확인 바랍니다"));
}

describe("MessageBubble reaction menu", () => {
  it("opens on the site tab, switches category, and stores the chosen emoji", () => {
    const onToggleReaction = vi.fn();
    const onReply = vi.fn();
    render(
      <MessageBubble
        message={message}
        isMe={false}
        onToggleReaction={onToggleReaction}
        onReply={onReply}
      />,
    );

    openMenu();

    expect(screen.getByText("난간 확인 바랍니다").closest(".select-none")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "⛑️", selected: true })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "표정" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "손짓" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "재미" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "확인" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "완료" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "검토중" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "주의" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "웃음" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "답장" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "복사" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "🙂" }));

    expect(screen.getByRole("tab", { name: "🙂", selected: true })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "웃음" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "확인" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "답장" })).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "웃음" }));
    expect(onToggleReaction).toHaveBeenCalledWith("msg-1", "😀");
  });
});
