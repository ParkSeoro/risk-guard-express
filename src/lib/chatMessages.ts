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

export const QUICK_CHAT_REACTIONS = [
  { emoji: "✅", label: "확인" },
  { emoji: "👍", label: "완료" },
  { emoji: "👀", label: "검토중" },
  { emoji: "🚨", label: "주의" },
] as const;

export function mergeChatMessages<T extends ChatMessageIdentity>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<string, T>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) {
    if (!byId.has(message.id)) byId.set(message.id, message);
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
    const parsed = JSON.parse(rawJson) as SafetyDocCardPayload;
    if (parsed && parsed.kind && parsed.id && parsed.title && parsed.url) {
      return { summaryText, card: parsed };
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
