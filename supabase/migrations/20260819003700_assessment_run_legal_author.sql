-- 고시 §7: 위험성평가 작성 주체 = 관리감독자(site_supervisor).
-- created_by 는 입력자(보좌 가능). author_user_id 가 법적 작성자.

ALTER TABLE public.assessment_runs
  ADD COLUMN IF NOT EXISTS author_user_id uuid;

COMMENT ON COLUMN public.assessment_runs.author_user_id IS
  '고시 §7 작성 주체(관리감독자). created_by는 입력자(보좌 가능).';

-- created_by 가 해당 프로젝트 관리감독자면 작성 주체로 승계
UPDATE public.assessment_runs ar
SET author_user_id = ar.created_by
WHERE ar.author_user_id IS NULL
  AND ar.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = ar.project_id
      AND pm.user_id = ar.created_by
      AND pm.role_new = 'site_supervisor'
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
      AND pm.role_new = 'site_supervisor'
  ) THEN
    RAISE EXCEPTION '작성 주체는 해당 프로젝트의 관리감독자여야 합니다.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assessment_run_author ON public.assessment_runs;
CREATE TRIGGER trg_assessment_run_author
BEFORE INSERT OR UPDATE OF author_user_id, project_id
ON public.assessment_runs
FOR EACH ROW
EXECUTE FUNCTION public.enforce_assessment_run_author();
