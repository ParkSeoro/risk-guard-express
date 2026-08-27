import { supabase } from "@/integrations/supabase/client";
import {
  permitPostStepKind,
  type PermitPostStepKind,
} from "@/lib/permitPostApproval";

export function approvalActionSuccessMessage(
  action: "approve" | "reject",
  kind: PermitPostStepKind,
): string {
  if (kind === "closure_sm") {
    return action === "approve" ? "작업 완료 및 종료 처리됨" : "종료 확인 반려";
  }
  if (kind === "closure_supervisor") {
    return action === "approve" ? "관리감독자 완료 확인됨" : "완료 확인 반려";
  }
  if (kind === "extend_cm") {
    return action === "approve" ? "발주처 CM 연장 검토 완료 → 발주처 SM 대기" : "연장 요청 반려";
  }
  if (kind === "extend_sm") {
    return action === "approve" ? "연장 승인 완료" : "연장 요청 반려";
  }
  return action === "approve" ? "승인 완료" : "반려 처리됨";
}

/** 반려 푸시/알림 본문 — 트리거 문구와 동일하게 유지. */
export function approvalRejectNotifyMessage(docTitle: string, comment?: string | null): string {
  const title = (docTitle || "문서").trim() || "문서";
  const reason = (comment || "").trim();
  return reason
    ? `${title}이(가) 반려되었습니다.\n사유: ${reason}`
    : `${title}이(가) 반려되었습니다.`;
}

export async function submitApprovalAction(opts: {
  approvalId: string;
  action: "approve" | "reject";
  comment?: string;
  entityType?: string | null;
  entityId?: string | null;
  projectId?: string | null;
  stepPosition?: string | null;
}): Promise<{ kind: PermitPostStepKind; result: any }> {
  const { data, error } = await supabase.rpc("act_on_approval", {
    _approval_id: opts.approvalId,
    _action: opts.action,
    _comment: opts.comment || "",
  });
  if (error) throw error;
  const result: any = data;
  if (result?.error) throw new Error(result.error);
  const kind = permitPostStepKind(opts.stepPosition);
  if (opts.action === "approve" && kind === "normal" && opts.entityType === "work_permit") {
    try {
      const { ensureTbmAfterPermitIssued } = await import("@/lib/tbmLifecycle");
      await ensureTbmAfterPermitIssued({
        rpcResult: result,
        entityType: opts.entityType,
        entityId: opts.entityId,
        projectId: opts.projectId,
      });
    } catch (e) {
      console.warn("ensureTbmAfterPermitIssued", e);
    }
  }
  return { kind, result };
}
