/**
 * Default worker PIN from phone: last 4 digits.
 * Used when admins bulk/manual-provision Auth accounts.
 */
export function workerPinFromPhone(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 4) return null;
  return d.slice(-4);
}
