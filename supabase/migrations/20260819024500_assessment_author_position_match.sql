-- 작성 주체: role 또는 position 이 소장/관리감독자면 허용 (직책 drift)

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
      AND (
        pm.role_new IN ('site_supervisor', 'site_manager')
        OR pm.position_new IN ('SITE_SUPERVISOR', 'SITE_MANAGER')
      )
  ) THEN
    RAISE EXCEPTION '작성 주체는 해당 프로젝트의 관리감독자 또는 현장소장이어야 합니다.';
  END IF;
  RETURN NEW;
END;
$$;
