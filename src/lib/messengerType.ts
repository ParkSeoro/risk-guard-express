import { parseSafetyDocMessage } from "@/lib/chatMessages";

/** 카카오톡에 맞춘 메신저 글자. 본문 16px, 목록 이름 16px, 미리보기 14px, 시간·읽음 12px. */
export const messengerType = {
  body: "text-base leading-relaxed",
  title: "text-base font-semibold",
  preview: "text-sm leading-snug",
  meta: "text-xs",
  input: "text-base leading-normal",
} as const;

export type ForwardAttachment = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  publicUrl: string;
  isImage: boolean;
};

export type ForwardPart = {
  content: string;
  attachment: ForwardAttachment | null;
};

type ForwardSource = {
  content?: string | null;
  attachments?: ReadonlyArray<{
    file_name?: string | null;
    file_size?: number | null;
    mime_type?: string | null;
    public_url?: string | null;
  }> | null;
};

/** 다른 방으로 보낼 새 메시지. 표는 만들지 않고 기존 전송을 다시 쓴다. */
export function forwardChatParts(message: ForwardSource): ForwardPart[] {
  const text = parseSafetyDocMessage(message.content || "").summaryText.trim();
  const files = (message.attachments || []).filter((file) => String(file.public_url || "").trim());
  if (files.length === 0) {
    return [{ content: text || "전달된 메시지", attachment: null }];
  }
  return files.map((file, index) => {
    const mime = String(file.mime_type || "application/octet-stream");
    const isImage = mime.startsWith("image/");
    const name = String(file.file_name || (isImage ? "사진" : "파일"));
    return {
      content: index === 0 ? text : "",
      attachment: {
        fileName: name,
        fileSize: Number(file.file_size || 0),
        mimeType: mime,
        publicUrl: String(file.public_url),
        isImage,
      },
    };
  });
}

export type ChatImageSlide = { url: string; name: string };

/** 불러온 대화의 사진을 시간순으로 모은다. 같은 주소는 한 장만 둔다. */
export function collectChatImages(
  messages: ReadonlyArray<{
    attachments?: ReadonlyArray<{
      mime_type?: string | null;
      public_url?: string | null;
      file_name?: string | null;
    }> | null;
  }>,
): ChatImageSlide[] {
  const slides: ChatImageSlide[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const file of message.attachments || []) {
      const url = String(file.public_url || "").trim();
      if (!url || seen.has(url)) continue;
      if (!String(file.mime_type || "").startsWith("image/")) continue;
      seen.add(url);
      slides.push({ url, name: String(file.file_name || "사진") });
    }
  }
  return slides;
}

export function chatImageIndex(slides: readonly ChatImageSlide[], url: string | null): number {
  if (!url) return -1;
  return slides.findIndex((slide) => slide.url === url);
}

/**
 * 내가 마지막으로 읽은 시각 다음의 첫 상대 메시지.
 * 그 메시지 위에 "여기까지 읽었습니다"를 붙인다. 없으면 줄을 그리지 않는다.
 */
export function readMarkerMessageId(
  messages: ReadonlyArray<{
    id: string;
    created_at: string;
    sender_id: string;
    message_type?: string | null;
  }>,
  lastReadAt: string | null | undefined,
  myUserId: string | null | undefined,
): string | null {
  const readAt = lastReadAt ? Date.parse(lastReadAt) : null;
  const hasReadAt = readAt != null && !Number.isNaN(readAt);
  for (const message of messages) {
    if (message.message_type === "SYSTEM") continue;
    if (myUserId && message.sender_id === myUserId) continue;
    const at = Date.parse(message.created_at);
    if (Number.isNaN(at)) continue;
    if (!hasReadAt || at > readAt) return message.id;
  }
  return null;
}
