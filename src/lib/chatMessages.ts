export const CHAT_MESSAGE_PAGE_SIZE = 50;

/** A reply jump stops after this many older pages so a missing id cannot loop. */
export const CHAT_HISTORY_JUMP_MAX_PAGES = 40;

export interface ChatMessageIdentity {
  id: string;
  created_at: string;
}

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
