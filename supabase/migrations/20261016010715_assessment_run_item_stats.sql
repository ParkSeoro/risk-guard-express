-- List screens need per-run item counts without fetching thousands of risk_items rows
-- (PostgREST max-rows truncates → "항목 0건" on newest runs).

CREATE OR REPLACE FUNCTION public.assessment_run_item_stats(_run_ids uuid[])
RETURNS TABLE (
  run_id uuid,
  total integer,
  high integer,
  med integer,
  low integer,
  residual integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH readable AS (
    SELECT r.id
      FROM public.assessment_runs r
     WHERE _run_ids IS NOT NULL
       AND cardinality(_run_ids) > 0
       AND r.id = ANY (_run_ids)
       AND public.can_read_assessment_run(r, auth.uid())
  )
  SELECT
    i.run_id,
    COUNT(*)::integer AS total,
    COUNT(*) FILTER (WHERE i.risk_grade = '상')::integer AS high,
    COUNT(*) FILTER (WHERE i.risk_grade = '중')::integer AS med,
    COUNT(*) FILTER (
      WHERE COALESCE(i.risk_grade, '') IS DISTINCT FROM '상'
        AND COALESCE(i.risk_grade, '') IS DISTINCT FROM '중'
    )::integer AS low,
    COUNT(*) FILTER (WHERE i.improved_risk_grade = '상')::integer AS residual
  FROM public.risk_items i
  JOIN readable rd ON rd.id = i.run_id
  WHERE COALESCE(i.is_deleted, false) = false
    AND COALESCE(i.is_excluded, false) = false
  GROUP BY i.run_id;
$$;

GRANT EXECUTE ON FUNCTION public.assessment_run_item_stats(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.assessment_run_item_stats(uuid[]) IS
  'Per-run risk_items counts for assessment list cards (respects can_read_assessment_run).';
