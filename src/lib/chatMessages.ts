export const CHAT_MESSAGE_PAGE_SIZE = 50;

/** A reply jump stops after this many older pages so a missing id cannot loop. */
export const CHAT_HISTORY_JUMP_MAX_PAGES = 40;

export interface ChatMessageIdentity {
  id: string;
  created_at: string;
}

export interface TimelineGroupingSource extends ChatMessageIdentity {
  sender_id: string;
  message_type?: string;
}

export interface TimelineGroupingMeta {
  showDateDivider: boolean;
  dateLabel: string;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
}

export interface SafetyDocCardPayload {
  kind: "work_permit" | "assessment_run" | "work_plan" | "tbm_session";
  id: string;
  title: string;
  subtitle?: string | null;
  statusLabel?: string | null;
  url: string;
  note?: string | null;
}

const SAFETY_DOC_PREFIX = "[[SAFENEX_DOC]]";
const SAFETY_DOC_KINDS = ["work_permit", "assessment_run", "work_plan", "tbm_session"] as const;
const SAFETY_DOC_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Open a shared card only by kind and document id. The url stored in the message is ignored. */
export function safetyDocAppPath(card: { kind?: string | null; id?: string | null }): string | null {
  const id = String(card.id || "");
  if (!SAFETY_DOC_UUID.test(id)) return null;
  switch (card.kind) {
    case "work_permit":
      return `/app/admin/work-permits/${id}`;
    case "assessment_run":
      return `/app/admin/assessment-run/${id}`;
    case "work_plan":
      return `/app/admin/work-plan/${id}`;
    default:
      return null;
  }
}

export interface ChatReactionChoice {
  emoji: string;
  label: string;
}

export const CHAT_REACTION_TABS = [
  { id: "site", icon: "⛑️" },
  { id: "face", icon: "🙂" },
  { id: "hand", icon: "✋" },
  { id: "fun", icon: "✨" },
] as const;

export type ChatReactionTabId = (typeof CHAT_REACTION_TABS)[number]["id"];

/** 우클릭 반응. chat_reactions.emoji 는 varchar(20)이라 그림 파일 주소는 넣지 않는다. */
export const CHAT_REACTION_CHOICES: Record<ChatReactionTabId, readonly ChatReactionChoice[]> = {
  site: [
    { emoji: "✅", label: "확인" },
    { emoji: "👍", label: "완료" },
    { emoji: "👀", label: "검토중" },
    { emoji: "🚨", label: "주의" },
    { emoji: "⚠️", label: "경고" },
    { emoji: "🛑", label: "중지" },
    { emoji: "⛑️", label: "안전모" },
    { emoji: "🦺", label: "안전조끼" },
    { emoji: "🚧", label: "통제" },
    { emoji: "🔥", label: "화기" },
    { emoji: "⚡", label: "전기" },
    { emoji: "🚑", label: "응급" },
    { emoji: "📋", label: "서류" },
    { emoji: "📝", label: "기록" },
    { emoji: "📌", label: "중요" },
    { emoji: "📸", label: "사진" },
    { emoji: "🔧", label: "보수" },
    { emoji: "🏗️", label: "공사" },
    { emoji: "📞", label: "연락" },
    { emoji: "📅", label: "일정" },
    { emoji: "🔁", label: "재확인" },
    { emoji: "❗", label: "필수" },
    { emoji: "❓", label: "문의" },
    { emoji: "🤝", label: "협의" },
  ],
  face: [
    { emoji: "😀", label: "웃음" },
    { emoji: "😁", label: "활짝" },
    { emoji: "😂", label: "폭소" },
    { emoji: "🙂", label: "미소" },
    { emoji: "😉", label: "윙크" },
    { emoji: "😊", label: "기분좋음" },
    { emoji: "😍", label: "좋음" },
    { emoji: "😎", label: "여유" },
    { emoji: "🤔", label: "생각" },
    { emoji: "😐", label: "무표정" },
    { emoji: "😑", label: "시큰둥" },
    { emoji: "😮", label: "놀람" },
    { emoji: "😯", label: "헉" },
    { emoji: "😲", label: "깜짝" },
    { emoji: "😢", label: "속상" },
    { emoji: "😭", label: "울음" },
    { emoji: "😤", label: "답답" },
    { emoji: "😠", label: "화남" },
    { emoji: "😱", label: "겁남" },
    { emoji: "😰", label: "긴장" },
    { emoji: "😴", label: "피곤" },
    { emoji: "🙄", label: "어이없음" },
    { emoji: "🫡", label: "경례" },
    { emoji: "😌", label: "안심" },
  ],
  hand: [
    { emoji: "👎", label: "아쉬움" },
    { emoji: "👌", label: "오케이" },
    { emoji: "✌️", label: "브이" },
    { emoji: "🤞", label: "기대" },
    { emoji: "🤘", label: "록" },
    { emoji: "🤙", label: "전화" },
    { emoji: "👈", label: "왼쪽" },
    { emoji: "👉", label: "오른쪽" },
    { emoji: "👆", label: "위" },
    { emoji: "👇", label: "아래" },
    { emoji: "☝️", label: "여기" },
    { emoji: "✋", label: "정지" },
    { emoji: "🤚", label: "손바닥" },
    { emoji: "🖐️", label: "펼침" },
    { emoji: "👋", label: "손인사" },
    { emoji: "👏", label: "박수" },
    { emoji: "🙌", label: "만세" },
    { emoji: "👐", label: "양손" },
    { emoji: "🙏", label: "부탁" },
    { emoji: "💪", label: "힘" },
    { emoji: "✊", label: "주먹" },
    { emoji: "👊", label: "주먹인사" },
    { emoji: "✍️", label: "서명" },
    { emoji: "🖖", label: "인사" },
  ],
  fun: [
    { emoji: "🤣", label: "빵터짐" },
    { emoji: "😆", label: "키득" },
    { emoji: "😅", label: "민망" },
    { emoji: "🙃", label: "뒤집힘" },
    { emoji: "😜", label: "메롱" },
    { emoji: "🤪", label: "장난" },
    { emoji: "😝", label: "장난스러움" },
    { emoji: "🤓", label: "공부" },
    { emoji: "🧐", label: "살핌" },
    { emoji: "😏", label: "능글" },
    { emoji: "😒", label: "시큰" },
    { emoji: "😬", label: "어색" },
    { emoji: "🤭", label: "킥킥" },
    { emoji: "🤫", label: "조용" },
    { emoji: "🤥", label: "거짓말" },
    { emoji: "🤡", label: "광대" },
    { emoji: "👻", label: "유령" },
    { emoji: "💀", label: "골때림" },
    { emoji: "🙈", label: "안 봄" },
    { emoji: "🙉", label: "안 들음" },
    { emoji: "🙊", label: "안 말함" },
    { emoji: "🎉", label: "축하" },
    { emoji: "💯", label: "백점" },
    { emoji: "⭐", label: "별" },
  ],
};

/** 예전 네 개. 현장 탭의 앞자리와 같다. */
export const QUICK_CHAT_REACTIONS = CHAT_REACTION_CHOICES.site.slice(0, 4);

export function mergeChatMessages<T extends ChatMessageIdentity & { attachments?: unknown[]; reactions?: unknown[] }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) {
    const prev = byId.get(message.id);
    if (!prev) {
      byId.set(message.id, message);
    } else {
      const prevAtt = Array.isArray(prev.attachments) ? prev.attachments : [];
      const nextAtt = Array.isArray(message.attachments) ? message.attachments : [];
      const prevRx = Array.isArray(prev.reactions) ? prev.reactions : [];
      const nextRx = Array.isArray(message.reactions) ? message.reactions : [];
      // 이미 있는 본문은 그대로 두고, 첨부와 반응은 더 긴 목록을 남긴다.
      byId.set(message.id, {
        ...message,
        ...prev,
        attachments: nextAtt.length >= prevAtt.length ? nextAtt : prevAtt,
        reactions: nextRx.length >= prevRx.length ? nextRx : prevRx,
      });
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const byTime = a.created_at.localeCompare(b.created_at);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });
}

export function dedupeChatContacts<T extends { user_id: string }>(contacts: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const contact of contacts) {
    if (!contact.user_id || seen.has(contact.user_id)) continue;
    seen.add(contact.user_id);
    unique.push(contact);
  }
  return unique;
}

/** PostgREST or-filter: rows strictly before this (created_at, id) cursor. */
export function olderChatMessagesFilter(createdAt: string, id: string): string {
  const ts = `"${createdAt.replace(/"/g, "")}"`;
  return `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${id})`;
}

/**
 * Compute how many active room participants (excluding the message sender)
 * have a last_read_at timestamp strictly older than the message's created_at.
 */
export function computeMessageUnreadCount(
  message: { sender_id: string; created_at: string; message_type?: string },
  participants?: ReadonlyArray<{ user_id: string; last_read_at?: string | null; left_at?: string | null }> | null,
): number {
  if (!participants || participants.length === 0) return 0;
  if (message.message_type === "SYSTEM") return 0;

  const msgTime = Date.parse(message.created_at);
  if (Number.isNaN(msgTime)) return 0;

  let unread = 0;
  for (const p of participants) {
    if (!p.user_id || p.user_id === message.sender_id || p.left_at) continue;
    if (!p.last_read_at) {
      unread += 1;
      continue;
    }
    const readTime = Date.parse(p.last_read_at);
    if (Number.isNaN(readTime) || readTime < msgTime) {
      unread += 1;
    }
  }
  return unread;
}

function toLocalDateKey(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalMinuteKey(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return `${toLocalDateKey(isoString)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatChatDateDivider(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/**
 * Annotate a chronological message list with date divider headers and
 * consecutive sender+minute grouping flags (KakaoWork / Naver Works style).
 */
export function annotateTimelineMessages<T extends TimelineGroupingSource>(
  messages: readonly T[],
): Array<T & TimelineGroupingMeta> {
  return messages.map((msg, idx) => {
    const prev = idx > 0 ? messages[idx - 1] : null;
    const next = idx < messages.length - 1 ? messages[idx + 1] : null;

    const curDateKey = toLocalDateKey(msg.created_at);
    const prevDateKey = prev ? toLocalDateKey(prev.created_at) : "";
    const nextDateKey = next ? toLocalDateKey(next.created_at) : "";

    const showDateDivider = idx === 0 || curDateKey !== prevDateKey;
    const dateLabel = showDateDivider ? formatChatDateDivider(msg.created_at) : "";

    const isSystem = msg.message_type === "SYSTEM";
    const prevIsSystem = prev?.message_type === "SYSTEM";
    const nextIsSystem = next?.message_type === "SYSTEM";

    const curMinKey = toLocalMinuteKey(msg.created_at);
    const prevMinKey = prev ? toLocalMinuteKey(prev.created_at) : "";
    const nextMinKey = next ? toLocalMinuteKey(next.created_at) : "";

    const sameAsPrev =
      !isSystem &&
      !prevIsSystem &&
      !showDateDivider &&
      Boolean(prev) &&
      prev!.sender_id === msg.sender_id &&
      prevMinKey === curMinKey;

    const sameAsNext =
      !isSystem &&
      !nextIsSystem &&
      Boolean(next) &&
      curDateKey === nextDateKey &&
      next!.sender_id === msg.sender_id &&
      nextMinKey === curMinKey;

    return {
      ...msg,
      showDateDivider,
      dateLabel,
      isFirstInGroup: !sameAsPrev,
      isLastInGroup: !sameAsNext,
    };
  });
}

export function encodeSafetyDocMessage(card: SafetyDocCardPayload): string {
  const kindLabel: Record<SafetyDocCardPayload["kind"], string> = {
    work_permit: "작업허가서",
    assessment_run: "위험성평가",
    work_plan: "작업계획서",
    tbm_session: "TBM 일지",
  };
  const summary = `[${kindLabel[card.kind]}] ${card.title}${card.note ? ` — ${card.note}` : ""}`;
  return `${ summary }\n${SAFETY_DOC_PREFIX}${JSON.stringify(card)}`;
}

export function parseSafetyDocMessage(content: string): {
  summaryText: string;
  card: SafetyDocCardPayload | null;
} {
  if (!content || !content.includes(SAFETY_DOC_PREFIX)) {
    return { summaryText: content || "", card: null };
  }
  const idx = content.indexOf(SAFETY_DOC_PREFIX);
  const summaryText = content.slice(0, idx).trim();
  const rawJson = content.slice(idx + SAFETY_DOC_PREFIX.length).trim();
  try {
    const parsed = JSON.parse(rawJson) as Partial<SafetyDocCardPayload>;
    if (
      parsed
      && typeof parsed.kind === "string"
      && (SAFETY_DOC_KINDS as readonly string[]).includes(parsed.kind)
      && typeof parsed.id === "string"
      && typeof parsed.title === "string"
    ) {
      return {
        summaryText,
        card: {
          kind: parsed.kind as SafetyDocCardPayload["kind"],
          id: parsed.id,
          title: parsed.title.slice(0, 200),
          subtitle: parsed.subtitle ? String(parsed.subtitle).slice(0, 200) : null,
          statusLabel: parsed.statusLabel ? String(parsed.statusLabel).slice(0, 40) : null,
          note: parsed.note ? String(parsed.note).slice(0, 200) : null,
          url: safetyDocAppPath(parsed) ?? "",
        },
      };
    }
  } catch {
    // Ignore malformed payload
  }
  return { summaryText: content, card: null };
}

export function formatCleanRoomPreview(lastMessageText?: string | null): string {
  if (!lastMessageText) return "새 대화방이 생성되었습니다.";
  const { summaryText } = parseSafetyDocMessage(lastMessageText);
  return summaryText || lastMessageText;
}

export interface CompanyContactGroup<T> {
  companyName: string;
  isSameCompany: boolean;
  members: T[];
}

export function groupContactsByCompany<
  T extends { company_name?: string | null; is_same_company?: boolean; full_name?: string | null },
>(contacts: readonly T[]): CompanyContactGroup<T>[] {
  const map = new Map<string, CompanyContactGroup<T>>();
  for (const c of contacts) {
    const name = c.company_name?.trim() || "소속 미지정";
    const existing = map.get(name);
    if (existing) {
      existing.members.push(c);
      if (c.is_same_company) existing.isSameCompany = true;
    } else {
      map.set(name, {
        companyName: name,
        isSameCompany: Boolean(c.is_same_company),
        members: [c],
      });
    }
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      members: [...group.members].sort((a, b) =>
        (a.full_name || "").localeCompare(b.full_name || "", "ko"),
      ),
    }))
    .sort((a, b) => {
      if (a.isSameCompany !== b.isSameCompany) return a.isSameCompany ? -1 : 1;
      if (a.companyName === "소속 미지정") return 1;
      if (b.companyName === "소속 미지정") return -1;
      return a.companyName.localeCompare(b.companyName, "ko");
    });
}
