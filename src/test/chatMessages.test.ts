import { describe, expect, it } from "vitest";
import {
  CHAT_HISTORY_JUMP_MAX_PAGES,
  CHAT_MESSAGE_PAGE_SIZE,
  annotateTimelineMessages,
  computeMessageUnreadCount,
  dedupeChatContacts,
  encodeSafetyDocMessage,
  formatCleanRoomPreview,
  groupContactsByCompany,
  safetyDocAppPath,
  mergeChatMessages,
  olderChatMessagesFilter,
  parseSafetyDocMessage,
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

describe("computeMessageUnreadCount", () => {
  it("counts active participants excluding sender whose last_read_at is older than message", () => {
    const participants = [
      { user_id: "me", last_read_at: "2026-11-04T01:00:00.000Z", left_at: null },
      { user_id: "u2", last_read_at: "2026-11-04T01:30:00.000Z", left_at: null },
      { user_id: "u3", last_read_at: "2026-11-04T03:00:00.000Z", left_at: null },
      { user_id: "u4", last_read_at: "2026-11-04T00:30:00.000Z", left_at: "2026-11-04T01:00:00.000Z" },
    ];
    const msg = {
      sender_id: "me",
      created_at: "2026-11-04T02:00:00.000Z",
      message_type: "TEXT",
    };

    expect(computeMessageUnreadCount(msg, participants)).toBe(1);
  });
});

describe("annotateTimelineMessages", () => {
  it("marks date dividers and merges consecutive messages from same sender in the same minute", () => {
    const rows = [
      { id: "1", sender_id: "u1", created_at: "2026-11-03T01:10:05.000Z", message_type: "TEXT" },
      { id: "2", sender_id: "u1", created_at: "2026-11-03T01:10:40.000Z", message_type: "TEXT" },
      { id: "3", sender_id: "u1", created_at: "2026-11-04T01:10:05.000Z", message_type: "TEXT" },
    ];
    const annotated = annotateTimelineMessages(rows);

    expect(annotated[0]?.showDateDivider).toBe(true);
    expect(annotated[0]?.isFirstInGroup).toBe(true);
    expect(annotated[0]?.isLastInGroup).toBe(false);

    expect(annotated[1]?.showDateDivider).toBe(false);
    expect(annotated[1]?.isFirstInGroup).toBe(false);
    expect(annotated[1]?.isLastInGroup).toBe(true);

    expect(annotated[2]?.showDateDivider).toBe(true);
    expect(annotated[2]?.isFirstInGroup).toBe(true);
    expect(annotated[2]?.isLastInGroup).toBe(true);
  });
});

describe("SafetyDocCard encoding & parsing", () => {
  it("round-trips a safety document card and cleans room preview text", () => {
    const encoded = encodeSafetyDocMessage({
      kind: "work_permit",
      id: "permit-1",
      title: "타워크레인 인양 작업허가서",
      subtitle: "2026-11-04 · 103동 옥상",
      statusLabel: "승인완료",
      url: "/app/admin/work-permits/permit-1",
      note: "오후 작업 전 확인 바랍니다.",
    });

    const parsed = parseSafetyDocMessage(encoded);
    expect(parsed.card?.id).toBe("permit-1");
    expect(parsed.card?.title).toBe("타워크레인 인양 작업허가서");
    expect(formatCleanRoomPreview(encoded)).toContain("[작업허가서] 타워크레인 인양 작업허가서");
    expect(parsed.card?.url).toBe("");
  });

  it("opens a card from kind and id, and drops a url written in the message", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const encoded = encodeSafetyDocMessage({
      kind: "work_permit",
      id,
      title: "안전블럭",
      url: "https://example.invalid/phish",
    });
    const parsed = parseSafetyDocMessage(encoded);
    expect(parsed.card?.url).toBe(`/app/admin/work-permits/${id}`);
    expect(safetyDocAppPath(parsed.card || { kind: "work_permit", id })).toBe(`/app/admin/work-permits/${id}`);
    expect(safetyDocAppPath({ kind: "work_permit", id: "not-a-uuid" })).toBeNull();
    expect(safetyDocAppPath({ kind: "tbm_session", id })).toBeNull();
  });
});

describe("groupContactsByCompany", () => {
  it("places same-company contacts first and sorts other companies alphabetically", () => {
    const grouped = groupContactsByCompany([
      { user_id: "1", full_name: "박소장", company_name: "대림전력", is_same_company: false },
      { user_id: "2", full_name: "김안전", company_name: "세이프넥스건설", is_same_company: true },
    ]);
    expect(grouped[0]?.companyName).toBe("세이프넥스건설");
    expect(grouped[1]?.companyName).toBe("대림전력");
  });
});
