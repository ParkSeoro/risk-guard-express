/**
 * useToastError — 모든 catch 블록을 표준화하는 헬퍼.
 *
 * @example
 *   const toastError = useToastError();
 *   try { ... } catch (e) { toastError(e, '저장 실패'); }
 */
import { toast } from "sonner";
import { useCallback } from "react";
import { normalizeError } from "@/lib/errors";

export function useToastError() {
  return useCallback((err: unknown, contextLabel?: string) => {
    const n = normalizeError(err);
    const title = contextLabel ? `${contextLabel}` : "오류";
    if (n.kind === "permission") {
      toast.error(title, { description: n.message });
    } else if (n.kind === "validation") {
      toast.warning(title, { description: n.message });
    } else {
      toast.error(title, { description: n.message });
    }
    // 디버깅용 — production에서도 콘솔에 남겨 사용자가 캡처 가능
    // eslint-disable-next-line no-console
    console.error("[ToastError]", title, n, n.raw);
    return n;
  }, []);
}
