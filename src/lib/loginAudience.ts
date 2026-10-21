export type LoginAudience = "worker" | "manager";

/**
 * First login tab.
 * Native does not force 근로자 — managers were landing on the worker form.
 * A registration QR or a phone already saved on this device still opens 근로자.
 */
export function initialLoginAudience(opts: {
  workerQr?: boolean;
  hasWorkerPhoneMemory?: boolean;
}): LoginAudience {
  if (opts.workerQr || opts.hasWorkerPhoneMemory) return "worker";
  return "manager";
}
