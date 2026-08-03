-- Backfill: permit-linked TBM sessions use permit author as leader_name (주관자).
-- Priority: submitted_by_name → form writer/author/applicant → created_by profile.

UPDATE public.tbm_sessions ts
SET
  leader_name = resolved.author_name,
  updated_at = now()
FROM (
  SELECT
    wp.tbm_session_id AS tbm_id,
    COALESCE(
      NULLIF(btrim(wp.submitted_by_name), ''),
      NULLIF(btrim(wp.form_data->>'writer_name'), ''),
      NULLIF(btrim(wp.form_data->>'author_name'), ''),
      NULLIF(btrim(wp.form_data->>'applicant_name'), ''),
      NULLIF(btrim(p.display_name), '')
    ) AS author_name
  FROM public.work_permits wp
  LEFT JOIN public.profiles p ON p.user_id = wp.created_by
  WHERE wp.tbm_session_id IS NOT NULL
    AND COALESCE(wp.is_deleted, false) = false
) resolved
WHERE ts.id = resolved.tbm_id
  AND resolved.author_name IS NOT NULL
  AND COALESCE(ts.is_deleted, false) = false
  AND ts.leader_name IS DISTINCT FROM resolved.author_name;
