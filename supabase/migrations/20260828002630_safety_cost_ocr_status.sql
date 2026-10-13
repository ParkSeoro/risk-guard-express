-- 안관비 항목 OCR 판독 상태 (원문·신뢰도·보정 출처)

ALTER TABLE public.safety_cost_items
  ADD COLUMN IF NOT EXISTS ocr_status text,
  ADD COLUMN IF NOT EXISTS ocr_raw_text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'safety_cost_items_ocr_status_chk'
  ) THEN
    ALTER TABLE public.safety_cost_items
      ADD CONSTRAINT safety_cost_items_ocr_status_chk
      CHECK (
        ocr_status IS NULL OR ocr_status IN (
          'ocr_raw', 'ocr_low', 'ai_corrected', 'rule_fallback', 'user_edited', 'no_vision'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.safety_cost_items.ocr_status IS 'OCR 판독 출처. 비우지 말고 ocr_raw|ocr_low|ai_corrected|rule_fallback|user_edited|no_vision 중 하나.';
COMMENT ON COLUMN public.safety_cost_items.ocr_raw_text IS 'OCR 원문 일부. AI 보정·사용자 수정과 대조.';
COMMENT ON COLUMN public.safety_cost_items.ocr_confidence IS 'OCR 신뢰도 0~1. 0.7 미만이면 ocr_low.';
