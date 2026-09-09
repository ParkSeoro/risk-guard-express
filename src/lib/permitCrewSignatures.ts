/**
 * 을지 인쇄: 당일 출근 서명이 있으면 이미지, 없으면 빈 칸(수기).
 * 허가서는 전날 승인·서명은 작업 당일 아침이라 아침 인쇄는 섞일 수 있다.
 * 늦게 출근 등록한 서명도 저장되며, 이후 조회/재인쇄(자료보존)에는 이미지로 나온다.
 */

export function phoneDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

export function isRenderableSignature(raw?: string | null): boolean {
  const s = String(raw || "").trim();
  return s.length >= 50 && (s.startsWith("data:image") || s.startsWith("http"));
}

export type CrewAckSignature = {
  worker_id?: string | null;
  worker_phone?: string | null;
  permit_ids?: string[] | null;
  signature_data?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

export type CrewTbmSignature = {
  worker_id?: string | null;
  worker_phone?: string | null;
  signature_data?: string | null;
  participated_at?: string | null;
};

function matchesCrewPerson(
  workerId: string,
  workerPhone: string | null | undefined,
  id?: string | null,
  phone?: string | null,
): boolean {
  if (id && id === workerId) return true;
  const digits = phoneDigits(workerPhone);
  const p = phoneDigits(phone);
  return Boolean(digits && p && digits === p);
}

export function pickCrewDailyAck(opts: {
  workerId: string;
  workerPhone?: string | null;
  permitId?: string | null;
  dailyAcks?: CrewAckSignature[];
}): CrewAckSignature | null {
  for (const ack of opts.dailyAcks || []) {
    if (!matchesCrewPerson(opts.workerId, opts.workerPhone, ack.worker_id, ack.worker_phone)) continue;
    if (!isRenderableSignature(ack.signature_data)) continue;
    const ids = Array.isArray(ack.permit_ids) ? ack.permit_ids.filter(Boolean) : [];
    if (opts.permitId && ids.length > 0 && !ids.includes(opts.permitId)) continue;
    return ack;
  }
  return null;
}

/** Prefer daily ack (출근 서명), then TBM participation. */
export function pickCrewPrintSignature(opts: {
  workerId: string;
  workerPhone?: string | null;
  permitId?: string | null;
  dailyAcks?: CrewAckSignature[];
  tbmParts?: CrewTbmSignature[];
}): string | null {
  const ack = pickCrewDailyAck(opts);
  if (ack?.signature_data) return String(ack.signature_data).trim();

  for (const part of opts.tbmParts || []) {
    if (!matchesCrewPerson(opts.workerId, opts.workerPhone, part.worker_id, part.worker_phone)) continue;
    if (!isRenderableSignature(part.signature_data)) continue;
    return String(part.signature_data).trim();
  }

  return null;
}

/** TBM 명단에서 빈 서명만 당일 출근 서명으로 채움(늦게 등록한 사람 포함, 자료보존). */
export function fillMissingTbmSignatures<T extends CrewTbmSignature>(
  parts: T[],
  dailyAcks?: CrewAckSignature[],
  permitId?: string | null,
): T[] {
  return parts.map((p) => {
    if (isRenderableSignature(p.signature_data)) return p;
    const ack = pickCrewDailyAck({
      workerId: String(p.worker_id || ""),
      workerPhone: p.worker_phone,
      permitId,
      dailyAcks,
    });
    if (!ack?.signature_data) return p;
    const signedAt = ack.updated_at || ack.created_at || p.participated_at;
    return { ...p, signature_data: String(ack.signature_data).trim(), participated_at: signedAt || p.participated_at };
  });
}

export function attachCrewPrintSignatures<T extends {
  id: string;
  phone?: string | null;
  signature_data?: string | null;
}>(
  workers: T[],
  opts: {
    permitId?: string | null;
    dailyAcks?: CrewAckSignature[];
    tbmParts?: CrewTbmSignature[];
  },
): T[] {
  return workers.map((w) => {
    const signature_data = pickCrewPrintSignature({
      workerId: w.id,
      workerPhone: w.phone,
      permitId: opts.permitId,
      dailyAcks: opts.dailyAcks,
      tbmParts: opts.tbmParts,
    });
    return signature_data ? { ...w, signature_data } : { ...w, signature_data: w.signature_data || null };
  });
}
