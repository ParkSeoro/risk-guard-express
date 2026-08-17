/** Decide whether a zone event is about the signed-in user (violator-only siren). */

function digitsOnly(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

export type ZoneEventIdentity = {
  worker_phone?: string | null;
  worker_qr_id?: string | null;
  worker_id?: string | null;
  worker_name?: string | null;
};

export type SelfIdentity = {
  phone?: string | null;
  workerId?: string | null;
};

/**
 * Local TTS/siren is for the violator only.
 * Match by phone or roster worker id — never by display name
 * (duplicate names would steal someone else's alarm onto this device).
 */
export function isZoneEventAboutMe(ev: ZoneEventIdentity, self: SelfIdentity): boolean {
  const evPhone = digitsOnly(ev.worker_phone);
  const myPhone = digitsOnly(self.phone);
  if (evPhone && myPhone && evPhone === myPhone) return true;

  const evWorkerId = String(ev.worker_id || ev.worker_qr_id || "").trim();
  const myWorkerId = String(self.workerId || "").trim();
  if (evWorkerId && myWorkerId && evWorkerId === myWorkerId) return true;

  return false;
}
