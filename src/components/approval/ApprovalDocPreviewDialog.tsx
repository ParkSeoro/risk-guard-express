/**
 * Desktop 전자결재 — stay on inbox, show document in a large dialog.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ZoomableDocumentPreview from "@/components/docs/ZoomableDocumentPreview";
import PermitReadOnlyPreview from "@/components/permits/PermitReadOnlyPreview";
import type { PermitFormData, PermitSignatures } from "@/components/permits/DigPermitForm";
import type { PermitAiBriefing } from "@/lib/permitBriefing";
import {
  A4_LANDSCAPE_PX,
  A4_PORTRAIT_PX,
  fetchAssessmentPrintHtml,
  fetchWorkPlanPrintHtml,
} from "@/lib/approvalDocPreview";
import { hydratePermitPreview } from "@/lib/permitPreviewHydrate";
import { supabase } from "@/integrations/supabase/client";
import { entityTypeLabel } from "@/lib/approvalRules";
import {
  canInlineApprovalPreview,
  desktopApprovalEntityPathFromInbox,
  type ApprovalPreviewTarget,
} from "@/lib/approvalInboxPreview";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ApprovalPreviewTarget | null;
};

export default function ApprovalDocPreviewDialog({ open, onOpenChange, target }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(A4_PORTRAIT_PX);
  const [permitForm, setPermitForm] = useState<PermitFormData>({});
  const [permitSigs, setPermitSigs] = useState<PermitSignatures>({});
  const [permitBriefing, setPermitBriefing] = useState<PermitAiBriefing | null>(null);
  const [permitMeta, setPermitMeta] = useState<{
    permitType?: string | null;
    permitKinds?: unknown;
  }>({});

  const entityType = target?.entityType || "";
  const entityId = target?.entityId || "";
  const isPermit = entityType === "work_permit";
  const isHtmlDoc =
    entityType === "assessment_run" ||
    entityType === "assessment_run_feedback" ||
    entityType === "work_plan";
  const inlineOk = canInlineApprovalPreview(entityType);
  const fullPath = desktopApprovalEntityPathFromInbox(entityType, entityId);
  const title =
    (target?.title && String(target.title).trim()) ||
    `${entityTypeLabel(entityType)} 문서`;

  useEffect(() => {
    if (!open || !target?.entityId || !inlineOk) {
      setHtml(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setHtml(null);
      try {
        if (entityType === "work_permit") {
          const { data: p, error: pe } = await supabase
            .from("work_permits" as any)
            .select(
              "id, ai_briefing, work_name, work_description, location, work_location, permit_date, status, form_data, permit_kinds, permit_type, contractor_company, personnel_count, signatures",
            )
            .eq("id", entityId)
            .maybeSingle();
          if (pe) throw pe;
          if (!p) throw new Error("허가서를 찾을 수 없습니다.");
          const hydrated = await hydratePermitPreview(p);
          if (cancelled) return;
          setPermitForm(hydrated.formData);
          setPermitSigs(hydrated.signatures);
          setPermitBriefing(hydrated.briefing);
          setPermitMeta({
            permitType: (p as any).permit_type,
            permitKinds: (p as any).permit_kinds,
          });
        } else if (entityType === "work_plan") {
          setPageWidth(A4_PORTRAIT_PX);
          const doc = await fetchWorkPlanPrintHtml(entityId);
          if (cancelled) return;
          setHtml(doc);
        } else if (
          entityType === "assessment_run" ||
          entityType === "assessment_run_feedback"
        ) {
          setPageWidth(A4_LANDSCAPE_PX);
          const doc = await fetchAssessmentPrintHtml(entityId);
          if (cancelled) return;
          setHtml(doc);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e) || "문서를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, target?.entityId, entityType, inlineOk, entityId]);

  const openFull = () => {
    if (!fullPath) return;
    onOpenChange(false);
    navigate(fullPath);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[96vw] h-[92vh] flex flex-col gap-3 p-4 sm:p-5 overflow-hidden">
        <DialogHeader className="flex-row items-center justify-between gap-2 space-y-0 pr-8">
          <DialogTitle className="text-base truncate flex-1">{title}</DialogTitle>
          {fullPath && (
            <Button type="button" size="sm" variant="outline" className="gap-1 shrink-0" onClick={openFull}>
              <ExternalLink className="h-3.5 w-3.5" />
              전체 화면
            </Button>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-auto rounded-md border bg-muted/20">
          {!inlineOk && (
            <div className="p-6 text-sm text-muted-foreground space-y-3">
              <p>이 유형은 미리보기를 지원하지 않습니다. 전체 화면에서 열어 주세요.</p>
              {fullPath && (
                <Button size="sm" onClick={openFull}>
                  문서 열기
                </Button>
              )}
            </div>
          )}

          {inlineOk && loading && (
            <div className="flex items-center justify-center gap-2 h-48 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              문서 불러오는 중…
            </div>
          )}

          {inlineOk && !loading && error && (
            <div className="p-6 text-sm space-y-3">
              <p className="text-destructive">{error}</p>
              {fullPath && (
                <Button size="sm" variant="outline" onClick={openFull}>
                  전체 화면에서 열기
                </Button>
              )}
            </div>
          )}

          {inlineOk && !loading && !error && isPermit && (
            <div className="p-3 sm:p-4">
              <PermitReadOnlyPreview
                formData={permitForm}
                signatures={permitSigs}
                briefing={permitBriefing}
                permitType={permitMeta.permitType}
                permitKinds={permitMeta.permitKinds}
              />
            </div>
          )}

          {inlineOk && !loading && !error && isHtmlDoc && (
            <ZoomableDocumentPreview
              html={html}
              loading={false}
              error={null}
              pageWidth={pageWidth}
              active={open}
              className="h-full min-h-[60vh]"
              emptyHint="표시할 문서가 없습니다"
            />
          )}
        </div>

        <p className="text-[11px] text-muted-foreground shrink-0">
          결재함은 그대로 유지됩니다. 닫은 뒤 승인·반려를 진행하세요.
        </p>
      </DialogContent>
    </Dialog>
  );
}
