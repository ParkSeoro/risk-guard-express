/**
 * Device-local worker login memory.
 * Native WebView often will not save 전화번호+PIN the way Chrome saves admin email/password.
 * Phone is always remembered; PIN only when the worker leaves "이 기기에서 저장" on.
 */
import { digitsOnlyPhone, formatPhoneMask, workerPhoneSchema, workerPinSchema } from "@/lib/workerAuth";

export const WORKER_LOGIN_MEMORY_KEY = "safenex.workerLogin.v1";

export type WorkerLoginMemory = {
  phone: string;
  pin?: string;
  rememberPin: boolean;
};

function readRaw(): unknown {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(WORKER_LOGIN_MEMORY_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadWorkerLoginMemory(): WorkerLoginMemory | null {
  const parsed = readRaw();
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const phoneParsed = workerPhoneSchema.safeParse(row.phone);
  if (!phoneParsed.success) return null;
  const rememberPin = row.rememberPin !== false;
  const pinParsed = rememberPin ? workerPinSchema.safeParse(row.pin) : null;
  return {
    phone: phoneParsed.data,
    pin: pinParsed?.success ? pinParsed.data : undefined,
    rememberPin,
  };
}

export function saveWorkerLoginMemory(opts: {
  phone: string;
  pin?: string;
  rememberPin: boolean;
}): void {
  const phoneParsed = workerPhoneSchema.safeParse(opts.phone);
  if (!phoneParsed.success) return;
  const pinParsed = opts.rememberPin ? workerPinSchema.safeParse(opts.pin) : null;
  const next: WorkerLoginMemory = {
    phone: phoneParsed.data,
    rememberPin: opts.rememberPin,
    ...(pinParsed?.success ? { pin: pinParsed.data } : {}),
  };
  try {
    localStorage.setItem(WORKER_LOGIN_MEMORY_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function clearWorkerLoginMemory(): void {
  try {
    localStorage.removeItem(WORKER_LOGIN_MEMORY_KEY);
  } catch {
    /* ignore */
  }
}

export function workerLoginPrefill(): { phone: string; pin: string; rememberPin: boolean } {
  const saved = loadWorkerLoginMemory();
  if (!saved) return { phone: "", pin: "", rememberPin: true };
  return {
    phone: formatPhoneMask(saved.phone),
    pin: saved.pin || "",
    rememberPin: saved.rememberPin,
  };
}

export function rememberWorkerLoginOnDevice(phone: string, pin: string, rememberPin: boolean): void {
  saveWorkerLoginMemory({
    phone: digitsOnlyPhone(phone),
    pin,
    rememberPin,
  });
}
