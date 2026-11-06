import { describe, expect, it } from "vitest";
import {
  DESKTOP_OTA_DOWNLOAD_FAILED,
  DESKTOP_OTA_NEEDS_INSTALLER,
  DESKTOP_OTA_STAGED,
  interpretDesktopStageReply,
} from "@/lib/desktopOtaApply";

describe("desktop OTA stage reply", () => {
  it("treats the old program's web page as a one-time installer", () => {
    const reply = interpretDesktopStageReply(200, "<!doctype html><html></html>");
    expect(reply.needsInstaller).toBe(true);
    expect(reply.message).toBe(DESKTOP_OTA_NEEDS_INSTALLER);
  });

  it("keeps a staged update for the next program start", () => {
    const reply = interpretDesktopStageReply(200, '{"ok":true,"pending":true,"version":"1.1.5-1"}');
    expect(reply.ok).toBe(true);
    expect(reply.pending).toBe(true);
    expect(reply.message).toBe(DESKTOP_OTA_STAGED);
  });

  it("hides an English shell error behind a Korean sentence", () => {
    const reply = interpretDesktopStageReply(
      200,
      '{"ok":false,"error":"The process cannot access the file because it is being used by another process."}',
    );
    expect(reply.ok).toBe(false);
    expect(reply.message).toBe(DESKTOP_OTA_DOWNLOAD_FAILED);
  });

  it("shows a Korean reason from the program", () => {
    const reply = interpretDesktopStageReply(
      200,
      '{"ok":false,"error":"업데이트 번들에 index.html이 포함되어 있지 않습니다."}',
    );
    expect(reply.message).toBe("업데이트 번들에 index.html이 포함되어 있지 않습니다.");
  });
});
