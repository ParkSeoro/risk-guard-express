import { describe, expect, it } from "vitest";
import {
  chatImageIndex,
  collectChatImages,
  forwardChatParts,
  messengerType,
  readMarkerMessageId,
} from "@/lib/messengerType";

describe("messenger type and kakao actions", () => {
  it("keeps body text larger than the time line", () => {
    expect(messengerType.body).toContain("text-sm");
    expect(messengerType.title).toContain("text-sm");
    expect(messengerType.preview).toContain("text-xs");
    expect(messengerType.meta).toContain("text-[11px]");
    expect(messengerType.input).toContain("text-sm");
  });

  it("forwards text as a new message and keeps the photo address", () => {
    expect(forwardChatParts({ content: "난간 확인" })).toEqual([
      { content: "난간 확인", attachment: null },
    ]);
    const parts = forwardChatParts({
      content: "현장 사진",
      attachments: [
        {
          file_name: "a.jpg",
          file_size: 10,
          mime_type: "image/jpeg",
          public_url: "https://files.example/a.jpg",
        },
        {
          file_name: "b.jpg",
          file_size: 11,
          mime_type: "image/jpeg",
          public_url: "https://files.example/b.jpg",
        },
      ],
    });
    expect(parts).toHaveLength(2);
    expect(parts[0]?.content).toBe("현장 사진");
    expect(parts[0]?.attachment?.publicUrl).toBe("https://files.example/a.jpg");
    expect(parts[0]?.attachment?.isImage).toBe(true);
    expect(parts[1]?.content).toBe("");
    expect(parts[1]?.attachment?.fileName).toBe("b.jpg");
  });

  it("walks room photos in order", () => {
    const slides = collectChatImages([
      { attachments: [{ mime_type: "application/pdf", public_url: "https://files.example/a.pdf", file_name: "a.pdf" }] },
      { attachments: [{ mime_type: "image/jpeg", public_url: "https://files.example/1.jpg", file_name: "1.jpg" }] },
      { attachments: [{ mime_type: "image/png", public_url: "https://files.example/2.png", file_name: "2.png" }] },
    ]);
    expect(slides.map((slide) => slide.name)).toEqual(["1.jpg", "2.png"]);
    expect(chatImageIndex(slides, "https://files.example/2.png")).toBe(1);
    expect(chatImageIndex(slides, "https://files.example/missing.jpg")).toBe(-1);
  });

  it("marks the first incoming message after my last read", () => {
    const messages = [
      { id: "old", created_at: "2026-11-06T00:00:00.000Z", sender_id: "other", message_type: "TEXT" },
      { id: "mine", created_at: "2026-11-06T01:00:00.000Z", sender_id: "me", message_type: "TEXT" },
      { id: "new", created_at: "2026-11-06T02:00:00.000Z", sender_id: "other", message_type: "TEXT" },
    ];
    expect(readMarkerMessageId(messages, "2026-11-06T00:30:00.000Z", "me")).toBe("new");
    expect(readMarkerMessageId(messages, "2026-11-06T03:00:00.000Z", "me")).toBeNull();
    expect(readMarkerMessageId(messages, null, "me")).toBe("old");
  });
});
