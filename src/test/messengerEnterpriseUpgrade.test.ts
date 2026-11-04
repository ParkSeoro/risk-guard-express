import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/20261104163000_messenger_enterprise_upgrade.sql",
  "utf8",
);

describe("messenger enterprise upgrade guards", () => {
  it("invites staff who share the room project, or the same client company", () => {
    expect(sql).toContain("IF NOT public.can_use_messenger(v_my_user_id)");
    expect(sql).toContain("JOIN public.project_members theirs");
    expect(sql).toContain("v_room_project_id IS NULL OR mine.project_id = v_room_project_id");
    expect(sql).toContain("messenger_shares_client_company(v_my_user_id, v_uid)");
    expect(sql).toContain("'client', '발주처', 'owner'");
  });

  it("lets only a room lead rename for everyone or pin a notice", () => {
    expect(sql).toContain("public.can_manage_chat_room(p_room_id, v_my_user_id)");
    expect(sql).toContain("Only the room owner can rename this room for everyone");
    expect(sql).toContain("Only the room owner can pin a notice");
  });

  it("reminds people who never opened the room, without repeating the message text", () => {
    expect(sql).toContain("p.last_read_at IS NULL OR p.last_read_at < v_msg_created_at");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain("RETURN -1");
    expect(sql).toContain("확인하지 않은 메시지가 있습니다.");
    expect(sql).not.toContain("v_msg_content");
  });

  it("counts unread rooms in one function and keeps the reminder table closed", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.count_my_chat_unreads");
    expect(sql).toContain("REVOKE ALL ON TABLE public.chat_message_reminders FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.can_manage_chat_room(uuid, uuid) FROM PUBLIC, anon, authenticated");
  });
});
