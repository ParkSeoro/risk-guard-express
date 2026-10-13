CREATE OR REPLACE FUNCTION public.list_my_open_education_sessions()
RETURNS TABLE (
  session_id uuid,
  course_name text,
  education_type text,
  held_on date,
  hours numeric,
  place text,
  outline text,
  instructor text,
  signed boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;
  SELECT public.normalize_phone_digits(p.phone) INTO _phone
  FROM public.profiles p WHERE p.user_id = _uid LIMIT 1;
  IF COALESCE(_phone, '') = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.course_name, s.education_type, s.held_on, s.hours, s.place, s.outline, s.instructor,
         length(btrim(COALESCE(a.signature_data, ''))) >= 80
  FROM public.education_session_attendees a
  JOIN public.education_sessions s ON s.id = a.session_id
  JOIN public.workers w ON w.id = a.worker_id
  WHERE s.status = 'open'
    AND public.normalize_phone_digits(w.phone) = _phone;
END;
$$;

REVOKE ALL ON FUNCTION public.list_my_open_education_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_my_open_education_sessions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_education_shortfall(_project_id uuid, _education_type text)
RETURNS TABLE (worker_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_project_member(auth.uid(), _project_id)
     AND NOT public.is_master(auth.uid()) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT w.id
  FROM public.workers w
  WHERE w.project_id = _project_id
    AND COALESCE(w.is_active, true) = true
    AND EXISTS (
      SELECT 1 FROM public.worker_legal_education_mapping m
      WHERE COALESCE(m.is_deleted, false) = false
        AND m.education_type = _education_type
        AND (
          m.job_type = public.resolve_legal_education_job_type(COALESCE(w.job_type, 'general'))
          OR m.job_type = 'all'
        )
        AND (m.is_system_default = true OR m.project_id = w.project_id)
    )
    AND NOT public.education_hours_met(w.id, _education_type, CURRENT_DATE);
END;
$$;

REVOKE ALL ON FUNCTION public.list_education_shortfall(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_education_shortfall(uuid, text) TO authenticated, service_role;
