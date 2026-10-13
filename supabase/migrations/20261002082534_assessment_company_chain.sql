-- One company owns one assessment chain.
-- A blank target_company_ids is the author's company, never a shared bucket.
-- Screen, approval preview, and PDF all call assessment_feedback_chain.

CREATE OR REPLACE FUNCTION public.project_member_role_rank(_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE lower(btrim(COALESCE(_role, '')))
    WHEN 'master' THEN 100
    WHEN 'project_admin' THEN 90
    WHEN 'safety_manager' THEN 80
    WHEN 'site_manager' THEN 70
    WHEN 'site_supervisor' THEN 60
    WHEN 'supervisor' THEN 50
    WHEN 'worker' THEN 20
    WHEN 'contractor' THEN 20
    WHEN 'viewer' THEN 10
    ELSE 0
  END;
$fn$;

-- Same rank as pickProjectMemberRow. Higher role wins. Ties use the earlier membership.
CREATE OR REPLACE FUNCTION public.assessment_run_effective_company_ids(_run public.assessment_runs)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT CASE
    WHEN COALESCE(array_length(_run.target_company_ids, 1), 0) > 0 THEN _run.target_company_ids
    ELSE COALESCE(
      (
        SELECT ARRAY[pm.company_id]
          FROM public.project_members pm
         WHERE pm.project_id = _run.project_id
           AND pm.user_id = COALESCE(_run.author_user_id, _run.created_by)
           AND pm.company_id IS NOT NULL
         ORDER BY public.project_member_role_rank(pm.role_new::text) DESC,
                  pm.created_at ASC,
                  pm.company_id
         LIMIT 1
      ),
      ARRAY[]::uuid[]
    )
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_company_ids_overlap(_a uuid[], _b uuid[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(array_length(_a, 1), 0) > 0
     AND COALESCE(array_length(_b, 1), 0) > 0
     AND _a && _b;
$fn$;

-- _same_type_only picks inside the current type. The wrapper falls back to other types
-- only when that pool has no earlier 승인완료 run.
CREATE OR REPLACE FUNCTION public.pick_previous_approved_assessment_run_pool(
  _current public.assessment_runs,
  _same_type_only boolean
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  WITH current_eff AS (
    SELECT public.assessment_run_effective_company_ids(_current) AS ids
  ),
  current_start AS (
    SELECT NULLIF(btrim(left(_current.start_date::text, 10)), '') AS start_key
  ),
  cand AS (
    SELECT
      ar.id,
      ar.created_at,
      COALESCE(
        NULLIF(btrim(left(ar.start_date::text, 10)), ''),
        to_char(ar.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ) AS period_key
    FROM public.assessment_runs ar
    CROSS JOIN current_eff ce
    WHERE ar.project_id = _current.project_id
      AND ar.id <> _current.id
      AND COALESCE(ar.is_deleted, false) = false
      AND ar.status = '승인완료'
      AND (
        NOT _same_type_only
        OR (
          NULLIF(btrim(COALESCE(_current.type, '')), '') IS NOT NULL
          AND ar.type IS NOT DISTINCT FROM _current.type
        )
      )
      AND public.assessment_company_ids_overlap(
        ce.ids,
        public.assessment_run_effective_company_ids(ar)
      )
  ),
  before_start AS (
    SELECT c.id, c.created_at, c.period_key
      FROM cand c
      CROSS JOIN current_start s
     WHERE s.start_key IS NOT NULL
       AND c.period_key IS NOT NULL
       AND c.period_key < s.start_key
  ),
  pool AS (
    SELECT * FROM before_start
    UNION ALL
    SELECT c.id, c.created_at, c.period_key
      FROM cand c
     WHERE NOT EXISTS (SELECT 1 FROM before_start)
       AND c.created_at < _current.created_at
  )
  SELECT p.id
    FROM pool p
   ORDER BY p.period_key DESC NULLS LAST, p.created_at DESC
   LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.pick_previous_approved_assessment_run(_current public.assessment_runs)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _id uuid;
BEGIN
  IF NULLIF(btrim(COALESCE(_current.type, '')), '') IS NOT NULL THEN
    _id := public.pick_previous_approved_assessment_run_pool(_current, true);
    IF _id IS NOT NULL THEN
      RETURN _id;
    END IF;
  END IF;
  RETURN public.pick_previous_approved_assessment_run_pool(_current, false);
END;
$fn$;

-- Saved previous_run_id is kept only for the same company and 승인완료·결재진행.
CREATE OR REPLACE FUNCTION public.resolve_assessment_previous_run(
  _current public.assessment_runs,
  _override uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _hint uuid;
  _prev public.assessment_runs;
BEGIN
  _hint := COALESCE(_override, _current.previous_run_id);
  IF _hint IS NOT NULL AND _hint <> _current.id THEN
    SELECT * INTO _prev
      FROM public.assessment_runs
     WHERE id = _hint;
    IF FOUND
       AND _prev.project_id = _current.project_id
       AND COALESCE(_prev.is_deleted, false) = false
       AND _prev.status IN ('승인완료', '결재진행')
       AND public.assessment_company_ids_overlap(
         public.assessment_run_effective_company_ids(_current),
         public.assessment_run_effective_company_ids(_prev)
       )
    THEN
      RETURN _prev.id;
    END IF;
  END IF;
  RETURN public.pick_previous_approved_assessment_run(_current);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.assessment_feedback_chain(
  _run_id uuid,
  _override_previous_id uuid DEFAULT NULL
)
RETURNS TABLE (
  previous_run_id uuid,
  previous_of_previous_run_id uuid,
  auto_previous_run_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _current public.assessment_runs;
  _prev public.assessment_runs;
  _role text;
BEGIN
  SELECT * INTO _current FROM public.assessment_runs WHERE id = _run_id;
  IF NOT FOUND OR COALESCE(_current.is_deleted, false) THEN
    RETURN;
  END IF;

  _role := COALESCE(auth.role(), '');
  IF _role IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR NOT public.can_read_assessment_run(_current, auth.uid()) THEN
      RETURN;
    END IF;
  END IF;

  auto_previous_run_id := public.pick_previous_approved_assessment_run(_current);
  previous_run_id := public.resolve_assessment_previous_run(_current, _override_previous_id);
  previous_of_previous_run_id := NULL;
  IF previous_run_id IS NOT NULL THEN
    SELECT * INTO _prev FROM public.assessment_runs WHERE id = previous_run_id;
    IF FOUND THEN
      previous_of_previous_run_id := public.pick_previous_approved_assessment_run(_prev);
    END IF;
  END IF;
  RETURN NEXT;
END;
$fn$;

REVOKE ALL ON FUNCTION public.project_member_role_rank(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_company_ids_overlap(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_previous_approved_assessment_run_pool(public.assessment_runs, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_previous_approved_assessment_run(public.assessment_runs) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_assessment_previous_run(public.assessment_runs, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assessment_feedback_chain(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assessment_feedback_chain(uuid, uuid) TO authenticated, service_role;

-- New and edited drafts cannot be saved with an empty company list.
-- Already-submitted rows are not rewritten here; the backfill below skips the lock.
CREATE OR REPLACE FUNCTION public.fill_blank_assessment_run_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF COALESCE(array_length(NEW.target_company_ids, 1), 0) > 0 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND current_setting('app.skip_document_edit_lock', true) IS DISTINCT FROM '1'
     AND COALESCE(OLD.status, '') IN ('결재진행', '승인완료', '승인') THEN
    RETURN NEW;
  END IF;
  NEW.target_company_ids := public.assessment_run_effective_company_ids(NEW);
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fill_blank_assessment_run_company() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_fill_blank_assessment_run_company ON public.assessment_runs;
CREATE TRIGGER trg_fill_blank_assessment_run_company
  BEFORE INSERT OR UPDATE ON public.assessment_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.fill_blank_assessment_run_company();

-- Only rows that still have no company. Does not move risk rows, photos, or existing tags.
SELECT set_config('app.skip_document_edit_lock', '1', true);

UPDATE public.assessment_runs ar
   SET target_company_ids = public.assessment_run_effective_company_ids(ar)
 WHERE COALESCE(ar.is_deleted, false) = false
   AND COALESCE(array_length(ar.target_company_ids, 1), 0) = 0
   AND COALESCE(array_length(public.assessment_run_effective_company_ids(ar), 1), 0) > 0;
