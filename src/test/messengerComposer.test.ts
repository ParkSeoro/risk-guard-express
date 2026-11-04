import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  keyboardCoveredPixels,
  messengerComposerPlaceholder,
} from "@/lib/messengerComposer";

const sql = readFileSync(
  "supabase/migrations/20261105094000_messenger_open_quiet_delete_master_admins.sql",
  "utf8",
);

describe("messenger composer layout", () => {
  it("keeps a one-line placeholder on a phone", () => {
    expect(messengerComposerPlaceholder(true)).toBe("메시지 입력");
    expect(messengerComposerPlaceholder(false)).toContain("Enter");
  });

  it("measures only the part of the column hidden under the keyboard", () => {
    expect(keyboardCoveredPixels({
      parentTop: 80,
      parentHeight: 700,
      viewportOffsetTop: 0,
      viewportHeight: 420,
    })).toBe(360);
    expect(keyboardCoveredPixels({
      parentTop: 80,
      parentHeight: 400,
      viewportOffsetTop: 0,
      viewportHeight: 500,
    })).toBe(0);
  });
});

describe("messenger open room, delete, and master directory", () => {
  it("skips push while that room is open and lets only the creator delete a group", () => {
    expect(sql).toContain("chat_room_presence");
    expect(sql).toContain("pres.updated_at > now() - interval '25 seconds'");
    expect(sql).toContain("Only the room creator can delete this room");
    expect(sql).toContain("Only a group room can be deleted");
    expect(sql).toContain("pm.role_new = 'project_admin'::public.project_role");
    expect(sql).not.toContain("v_is_master = TRUE");
    expect(sql).not.toContain("에어리퀴드");
  });
});
