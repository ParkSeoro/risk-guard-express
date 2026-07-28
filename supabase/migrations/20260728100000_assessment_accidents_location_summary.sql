-- Decouple accident AI schema: location + summary for KOSHA-style cases
ALTER TABLE public.assessment_accidents
  ADD COLUMN IF NOT EXISTS location text DEFAULT '',
  ADD COLUMN IF NOT EXISTS accident_summary text DEFAULT '';

COMMENT ON COLUMN public.assessment_accidents.location IS '사고 발생장소 (KOSHA-style)';
COMMENT ON COLUMN public.assessment_accidents.accident_summary IS '사고개요 (뉴스형 요약)';
