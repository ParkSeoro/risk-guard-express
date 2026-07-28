-- Work permit bundled kinds + AI approval briefing
ALTER TABLE public.work_permits
  ADD COLUMN IF NOT EXISTS ai_briefing jsonb;

COMMENT ON COLUMN public.work_permits.ai_briefing IS
  'AI-generated mobile approval briefing: work_overview, included_kinds, top_risks, required_controls, generated_at';

COMMENT ON COLUMN public.work_permits.permit_kinds IS
  'Selected permit sheet kinds for this single-task bundle (general/confined_space/hot_work/excavation)';

-- Backfill permit_kinds from permit_type when empty
UPDATE public.work_permits
SET permit_kinds = ARRAY[COALESCE(NULLIF(permit_type, ''), 'general')]
WHERE permit_kinds IS NULL OR cardinality(permit_kinds) = 0;
