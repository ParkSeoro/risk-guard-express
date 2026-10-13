CREATE OR REPLACE FUNCTION public.trg_worker_education_record_complete_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _subtype text;
BEGIN
  _subtype := public.education_record_requirement_subtype(NEW.education_type);
  IF NEW.worker_id IS NULL OR _subtype IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_deleted, false) THEN
    RETURN NEW;
  END IF;
  IF NOT public.education_hours_met(NEW.worker_id, _subtype, NEW.completed_at) THEN
    RETURN NEW;
  END IF;

  UPDATE public.worker_required_items
     SET status = 'done',
         completed_at = now(),
         completed_ref_id = NEW.id,
         updated_at = now()
   WHERE worker_id = NEW.worker_id
     AND item_type = 'education'
     AND subtype = _subtype
     AND status IN ('pending', 'overdue')
     AND COALESCE(is_deleted, false) = false;

  IF _subtype = 'new_hire_construction' THEN
    UPDATE public.worker_required_items
       SET status = 'done',
           completed_at = now(),
           completed_ref_id = NEW.id,
           updated_at = now()
     WHERE worker_id = NEW.worker_id
       AND item_type = 'education'
       AND subtype = 'new_hire'
       AND status IN ('pending', 'overdue')
       AND COALESCE(is_deleted, false) = false;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_education_session_write_ledger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'closed' OR OLD.status = 'closed' THEN
    RETURN NEW;
  END IF;

  NEW.closed_at := COALESCE(NEW.closed_at, now());

  INSERT INTO public.worker_education_records (
    project_id, worker_id, company_id, education_type, course_name, hours,
    completed_at, instructor, notes, created_by, session_id
  )
  SELECT
    NEW.project_id,
    a.worker_id,
    w.company_id,
    NEW.education_type,
    NEW.course_name,
    NEW.hours,
    NEW.held_on,
    NULLIF(btrim(COALESCE(NEW.instructor, '')), ''),
    'education_session',
    COALESCE(auth.uid(), NEW.created_by),
    NEW.id
  FROM public.education_session_attendees a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.session_id = NEW.id
    AND length(btrim(COALESCE(a.signature_data, ''))) >= 80
    AND NOT EXISTS (
      SELECT 1 FROM public.worker_education_records r
      WHERE r.session_id = NEW.id
        AND r.worker_id = a.worker_id
        AND COALESCE(r.is_deleted, false) = false
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_education_session_write_ledger ON public.education_sessions;
CREATE TRIGGER trg_education_session_write_ledger
  BEFORE UPDATE OF status ON public.education_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_education_session_write_ledger();

CREATE OR REPLACE FUNCTION public.sign_education_session(_session_id uuid, _signature text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _phone text;
  _session public.education_sessions%ROWTYPE;
  _worker_id uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHORIZED');
  END IF;
  IF _signature IS NULL OR length(_signature) < 80 THEN
    RETURN jsonb_build_object('error', 'SIGNATURE_REQUIRED');
  END IF;
  SELECT * INTO _session FROM public.education_sessions WHERE id = _session_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'SESSION_NOT_FOUND');
  END IF;
  IF _session.status <> 'open' THEN
    RETURN jsonb_build_object('error', 'SESSION_CLOSED');
  END IF;
  SELECT public.normalize_phone_digits(p.phone) INTO _phone
  FROM public.profiles p
  WHERE p.user_id = _uid
  LIMIT 1;
  IF COALESCE(_phone, '') = '' THEN
    RETURN jsonb_build_object('error', 'NO_WORKER');
  END IF;
  SELECT a.worker_id INTO _worker_id
  FROM public.education_session_attendees a
  JOIN public.workers w ON w.id = a.worker_id
  WHERE a.session_id = _session_id
    AND public.normalize_phone_digits(w.phone) = _phone
  LIMIT 1;
  IF _worker_id IS NULL THEN
    RETURN jsonb_build_object('error', 'NOT_INVITED');
  END IF;
  UPDATE public.education_session_attendees
     SET signature_data = _signature,
         signed_at = now()
   WHERE session_id = _session_id
     AND worker_id = _worker_id;
  RETURN jsonb_build_object('success', true, 'worker_id', _worker_id);
END;
$$;

REVOKE ALL ON FUNCTION public.sign_education_session(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sign_education_session(uuid, text) TO authenticated, service_role;
