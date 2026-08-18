import DigPermitForm, {
  type PermitFormData,
  type PermitSignatures,
  type PermitType,
} from "@/components/permits/DigPermitForm";
import StandardPermitSheet from "@/components/permits/StandardPermitSheet";
import PermitAiBriefingCard from "@/components/permits/PermitAiBriefingCard";
import type { PermitAiBriefing } from "@/lib/permitBriefing";
import { Button } from "@/components/ui/button";
import { normalizePermitKinds, type PermitKindId } from "@/lib/permitKinds";
import { useMemo, useState } from "react";

function getForm(p: any) {
  return p?.form_data && typeof p.form_data === "object" ? p.form_data : {};
}

export function permitRowToFormData(p: any): PermitFormData {
  const fd = getForm(p);
  return {
    ...fd,
    contractor_company: fd.contractor_company || p.contractor_company || "",
    applicant_company: fd.applicant_company || p.contractor_company || "",
    work_name: fd.work_name || p.work_name || "",
    work_description: fd.work_description || p.work_description || "",
    work_location: fd.work_location || p.location || p.work_location || "",
    personnel_count: fd.personnel_count ?? p.personnel_count ?? 0,
    work_start: fd.work_start || "",
    work_end: fd.work_end || "",
  };
}

type Props = {
  formData: PermitFormData;
  signatures: PermitSignatures;
  briefing?: PermitAiBriefing | null;
  permitType?: string | null;
  permitKinds?: unknown;
  loading?: boolean;
};

/** Read-only permit body shared by 문서보기 and 결재 상세. */
export default function PermitReadOnlyPreview({
  formData,
  signatures,
  briefing,
  permitType,
  permitKinds,
  loading,
}: Props) {
  const kinds = useMemo(
    () => normalizePermitKinds(permitKinds, (permitType || "general") as PermitKindId),
    [permitKinds, permitType],
  );
  const [kind, setKind] = useState<PermitKindId>(
    kinds.includes(permitType as PermitKindId) ? (permitType as PermitKindId) : kinds[0],
  );

  if (loading) return null;

  return (
    <div className="space-y-3">
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "default" : "outline"}
              onClick={() => setKind(k)}
            >
              {k}
            </Button>
          ))}
        </div>
      )}
      <PermitAiBriefingCard briefing={briefing ?? null} />
      <div className="bg-white border rounded shadow-sm p-2 overflow-x-auto">
        <StandardPermitSheet>
          <DigPermitForm
            permitType={kind as PermitType}
            data={formData}
            signatures={signatures}
            readOnly
          />
        </StandardPermitSheet>
      </div>
    </div>
  );
}
