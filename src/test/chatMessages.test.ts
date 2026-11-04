import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_JUMP_MAX_PAGES,
  CHAT_MESSAGE_PAGE_SIZE,
  dedupeChatContacts,
  mergeChatMessages,
  olderChatMessagesFilter,
} from "@/lib/chatMessages";

describe("mergeChatMessages", () => {
  it("keeps older pages and the newest page in time order without a 100-row ceiling", () => {
    const older = [
      { id: "a", created_at: "2026-11-01T00:00:00.000Z", content: "old" },
      { id: "b", created_at: "2026-11-02T00:00:00.000Z", content: "mid" },
    ];
    const newest = [
      { id: "b", created_at: "2026-11-02T00:00:00.000Z", content: "mid-fresh" },
      { id: "c", created_at: "2026-11-03T00:00:00.000Z", content: "new" },
    ];

    expect(mergeChatMessages(newest, older).map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(mergeChatMessages(newest, older)[1]?.content).toBe("mid-fresh");
  });

  it("orders rows that share a timestamp by id", () => {
    const merged = mergeChatMessages(
      [{ id: "b", created_at: "2026-11-04T00:00:00.000Z" }],
      [{ id: "a", created_at: "2026-11-04T00:00:00.000Z" }],
    );
    expect(merged.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("dedupeChatContacts", () => {
  it("keeps the first row for a user who appears on more than one project", () => {
    const contacts = dedupeChatContacts([
      { user_id: "u1", full_name: "김안전" },
      { user_id: "u1", full_name: "김안전-중복" },
      { user_id: "u2", full_name: "이관리" },
      { user_id: "", full_name: "빈값" },
    ]);
    expect(contacts).toEqual([
      { user_id: "u1", full_name: "김안전" },
      { user_id: "u2", full_name: "이관리" },
    ]);
  });
});

describe("olderChatMessagesFilter", () => {
  it("quotes the timestamp so a page cursor can walk past the first page", () => {
    expect(olderChatMessagesFilter("2026-11-04T02:12:16.000Z", "11111111-1111-1111-1111-111111111111"))
      .toBe(
        'created_at.lt."2026-11-04T02:12:16.000Z",and(created_at.eq."2026-11-04T02:12:16.000Z",id.lt.11111111-1111-1111-1111-111111111111)',
      );
    expect(CHAT_MESSAGE_PAGE_SIZE).toBeLessThan(100);
    expect(CHAT_HISTORY_JUMP_MAX_PAGES * CHAT_MESSAGE_PAGE_SIZE).toBeGreaterThan(100);
  });
});
