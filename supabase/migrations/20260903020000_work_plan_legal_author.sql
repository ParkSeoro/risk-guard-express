-- 작업계획서 법적 작성 주체 = 관리감독자(site_supervisor).
-- created_by 는 입력자(보좌 가능). author_user_id 가 법적 작성자.

ALTER TABLE public.work_plans
  ADD COLUMN IF NOT EXISTS author_user_id uuid;

COMMENT ON COLUMN public.work_plans.author_user_id IS
  '작업계획서 작성 주체(관리감독자). created_by는 입력자(보좌 가능).';

-- created_by 가 해당 프로젝트 관리감독자면 작성 주체로 승계
-- 상신·승인 문서 잠금 우회 (author_user_id 백필만)
SELECT set_config('app.skip_document_edit_lock', '1', true);

UPDATE public.work_plans wp
SET author_user_id = wp.created_by
WHERE wp.author_user_id IS NULL
  AND wp.created_by IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.project_members pm
    WHERE pm.project_id = wp.project_id
      AND pm.user_id = wp.created_by
      AND pm.role_new = 'site_supervisor'
  );

CREATE OR REPLACE FUNCTION public.enforce_work_plan_author()
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

DROP TRIGGER IF EXISTS trg_work_plan_author ON public.work_plans;
CREATE TRIGGER trg_work_plan_author
BEFORE INSERT OR UPDATE OF author_user_id, project_id
ON public.work_plans
FOR EACH ROW
EXECUTE FUNCTION public.enforce_work_plan_author();
