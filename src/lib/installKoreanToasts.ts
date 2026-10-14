import { toast } from "sonner";
import type { ExternalToast } from "sonner";
import { toKoreanWarning } from "@/lib/errors";

let installed = false;

function localizeMessage(message: unknown): unknown {
  if (typeof message !== "string") return message;
  const next = toKoreanWarning(message);
  if (next !== message) console.error("[toast:ko]", message);
  return next;
}

function localizeData(data?: ExternalToast): ExternalToast | undefined {
  if (!data || typeof data.description !== "string") return data;
  const next = toKoreanWarning(data.description);
  if (next === data.description) return data;
  console.error("[toast:ko]", data.description);
  return { ...data, description: next };
}

/** sonner 경고·오류 토스트가 영문 DB/네트워크 문장을 그대로 띄우지 않게 합니다. */
export function installKoreanToasts() {
  if (installed) return;
  installed = true;
  const error = toast.error.bind(toast);
  const warning = toast.warning.bind(toast);
  toast.error = (message, data) => error(localizeMessage(message) as string, localizeData(data));
  toast.warning = (message, data) => warning(localizeMessage(message) as string, localizeData(data));
}
