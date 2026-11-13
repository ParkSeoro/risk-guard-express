import { supabase } from "@/integrations/supabase/client";

export type OcrDocumentType = "education_certificate" | "construction_contract";

export type EducationCertificateDraft = {
  worker_name?: string | null;
  education_type?: string | null;
  course_name?: string | null;
  hours?: number | null;
  completed_at?: string | null;
  instructor?: string | null;
  notes?: string | null;
};

export type ConstructionContractDraft = {
  construction_amount?: number | null;
  start_date?: string | null;
  end_date?: string | null;
  work_scope?: string | null;
  contract_type?: string | null;
  contractor_name?: string | null;
  notes?: string | null;
};

export type OcrDraftResponse<T> = {
  ok: boolean;
  draft: T;
  ocr_status?: string;
  confidence?: number | null;
  warning?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("파일을 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

export async function extractDocumentDraft<T extends Record<string, unknown>>(
  documentType: OcrDocumentType,
  file: File,
): Promise<OcrDraftResponse<T>> {
  try {
    const fileBase64 = await fileToBase64(file);
    const { data, error } = await supabase.functions.invoke("ocr-document-draft", {
      body: {
        documentType,
        fileBase64,
        mimeType: file.type || "image/jpeg",
      },
    });
    if (error || !data) {
      return {
        ok: false,
        draft: {} as T,
        warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
      };
    }
    return data as OcrDraftResponse<T>;
  } catch {
    return {
      ok: false,
      draft: {} as T,
      warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
    };
  }
}
