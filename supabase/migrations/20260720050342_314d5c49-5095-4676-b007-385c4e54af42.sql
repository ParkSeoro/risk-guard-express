-- 엑셀 그리드 관련 컬럼 제거 (PDF 오버레이 단일화)
ALTER TABLE public.permit_form_templates
  DROP COLUMN IF EXISTS grid_snapshot,
  DROP COLUMN IF EXISTS input_cells,
  DROP COLUMN IF EXISTS source_xlsx_url;