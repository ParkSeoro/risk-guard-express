-- 작성 주체: 관리감독자 + 현장소장 (현장마다 소장이 작성하는 경우)

COMMENT ON COLUMN public.assessment_runs.author_user_id IS
  '작성 주체(관리감독자 또는 현장소장). created_by는 입력자(보좌 가능).';

UPDATE public.assessment_runs ar
SET author_user_id = ar.created_by
WHERE ar.author_user_id IS NULL
  AND ar.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = ar.project_id
      AND pm.user_id = ar.created_by
      AND pm.role_new = 'site_manager'
  );

CREATE OR REPLACE FUNCTION public.enforce_assessment_run_author()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.author_user_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = NEW.project_id
      AND pm.user_id = NEW.author_user_id
      AND pm.role_new IN ('site_supervisor', 'site_manager')
  ) THEN
    RAISE EXCEPTION '작성 주체는 해당 프로젝트의 관리감독자 또는 현장소장이어야 합니다.';
  END IF;
  RETURN NEW;
END;
$$;
