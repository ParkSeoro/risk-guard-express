-- Persist AI Vision OCR extraction & expiry dates on work_plan_attachments
-- Additive nullable columns only: zero impact on existing rows, uploads, or approvals.

ALTER TABLE public.work_plan_attachments
  ADD COLUMN IF NOT EXISTS ocr_meta jsonb,
  ADD COLUMN IF NOT EXISTS doc_issue_date date,
  ADD COLUMN IF NOT EXISTS doc_expiry_date date,
  ADD COLUMN IF NOT EXISTS ocr_checked_at timestamptz;

COMMENT ON COLUMN public.work_plan_attachments.ocr_meta IS 'AI Vision OCR extraction summary (docCategoryLabel, companyOrHolder, regOrCertNo, ratedCapacityTon, summary, confidence, notes)';
COMMENT ON COLUMN public.work_plan_attachments.doc_issue_date IS 'Extracted document issue date (YYYY-MM-DD)';
COMMENT ON COLUMN public.work_plan_attachments.doc_expiry_date IS 'Extracted inspection/insurance/license expiry date (YYYY-MM-DD)';
COMMENT ON COLUMN public.work_plan_attachments.ocr_checked_at IS 'Timestamp when AI OCR verification last completed';

CREATE INDEX IF NOT EXISTS idx_work_plan_attachments_expiry
  ON public.work_plan_attachments (work_plan_id, doc_expiry_date)
  WHERE doc_expiry_date IS NOT NULL AND is_deleted = false;
