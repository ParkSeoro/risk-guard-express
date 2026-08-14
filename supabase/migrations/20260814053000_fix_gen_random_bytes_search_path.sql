-- QR-only worker identity was retired (see docs/worker-qr-only-retired.md).
-- Bulk insert still minted workers.qr_token via gen_random_bytes(), which
-- fails under SET search_path = public. Do not generate worker QR tokens.

ALTER TABLE public.workers
  ALTER COLUMN qr_token DROP NOT NULL,
  ALTER COLUMN qr_token DROP DEFAULT;

CREATE OR REPLACE FUNCTION public.upsert_project_workers_bulk(
  _project_id uuid,
  _company_id uuid,
  _company_name text,
  _rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  r jsonb;
  v_name text;
  v_phone text;
  v_digits text;
  v_job text;
  v_birth date;
  v_hire date;
  v_existing public.workers%ROWTYPE;
  v_inserted int := 0;
  v_updated int := 0;
  v_claimed int := 0;
  v_failed jsonb := '[]'::jsonb;
  v_label text := public.normalize_company_label(_company_name);
  v_exist_label text;
  v_can_touch boolean;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('error', 'UNAUTHENTICATED');
  END IF;
  IF _project_id IS NULL OR _company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'PROJECT_OR_COMPANY_REQUIRED');
  END IF;
  IF NOT public.can_write_company_data(v_uid, _project_id, _company_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;
  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('error', 'ROWS_MUST_BE_ARRAY');
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(_rows, '[]'::jsonb))
  LOOP
    BEGIN
      v_name := nullif(trim(COALESCE(r->>'name', '')), '');
      v_phone := nullif(trim(COALESCE(r->>'phone', '')), '');
      v_digits := public.normalize_phone_digits(v_phone);
      v_job := nullif(trim(COALESCE(r->>'job_type', '')), '');
      v_birth := NULLIF(r->>'birth_date', '')::date;
      v_hire := NULLIF(r->>'hire_date', '')::date;

      IF v_name IS NULL OR length(v_digits) < 9 OR v_job IS NULL THEN
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'phone', v_phone, 'error', 'INVALID_ROW'
        ));
        CONTINUE;
      END IF;

      IF length(v_digits) = 11 AND v_digits LIKE '010%' THEN
        v_phone := substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 4) || '-' || substr(v_digits, 8, 4);
      END IF;

      SELECT * INTO v_existing
      FROM public.workers w
      WHERE w.project_id = _project_id
        AND public.normalize_phone_digits(w.phone) = v_digits
      ORDER BY CASE WHEN w.company_id = _company_id THEN 0
                    WHEN w.company_id IS NULL THEN 1
                    ELSE 2 END,
               w.created_at ASC
      LIMIT 1;

      IF NOT FOUND THEN
        INSERT INTO public.workers (
          project_id, company_id, company_name, name, phone, job_type,
          birth_date, hire_date, is_active
        ) VALUES (
          _project_id, _company_id, COALESCE(nullif(trim(_company_name), ''), ''),
          v_name, v_phone, v_job, v_birth, v_hire, true
        );
        v_inserted := v_inserted + 1;
        CONTINUE;
      END IF;

      v_can_touch := false;
      IF v_existing.company_id IS NULL THEN
        v_exist_label := public.normalize_company_label(v_existing.company_name);
        IF v_exist_label = '' OR v_exist_label = v_label THEN
          v_can_touch := true;
        END IF;
      ELSIF v_existing.company_id = _company_id THEN
        v_can_touch := true;
      ELSIF public.can_write_company_data(v_uid, _project_id, v_existing.company_id) THEN
        v_can_touch := true;
      END IF;

      IF NOT v_can_touch THEN
        v_failed := v_failed || jsonb_build_array(jsonb_build_object(
          'phone', v_phone,
          'error', 'OTHER_COMPANY',
          'existing_company_id', v_existing.company_id
        ));
        CONTINUE;
      END IF;

      UPDATE public.workers
         SET company_id = CASE
               WHEN company_id IS NULL THEN _company_id
               ELSE company_id
             END,
             company_name = CASE
               WHEN company_id IS NULL OR company_id = _company_id
                 THEN COALESCE(nullif(trim(_company_name), ''), company_name)
               ELSE company_name
             END,
             name = v_name,
             phone = v_phone,
             job_type = v_job,
             birth_date = COALESCE(v_birth, birth_date),
             hire_date = COALESCE(v_hire, hire_date),
             is_active = true,
             updated_at = now()
       WHERE id = v_existing.id;

      IF v_existing.company_id IS NULL THEN
        v_claimed := v_claimed + 1;
      ELSE
        v_updated := v_updated + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed || jsonb_build_array(jsonb_build_object(
        'phone', r->>'phone',
        'error', SQLERRM
      ));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'claimed', v_claimed,
    'failed', v_failed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_project_workers_bulk(uuid, uuid, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_worker_roster_signup(
  _user_id uuid,
  _project_id uuid,
  _company_id uuid,
  _name text,
  _phone text,
  _job_type text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _company_name text;
  _digits text;
  _worker_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() IS DISTINCT FROM _user_id
     AND NOT public.is_master(auth.uid()) THEN
    RAISE EXCEPTION '권한이 없습니다';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.project_companies
    WHERE project_id = _project_id AND company_id = _company_id AND is_deleted = false
  ) THEN
    RETURN jsonb_build_object('error', '유효하지 않은 프로젝트/업체');
  END IF;

  SELECT c.name INTO _company_name FROM public.companies c WHERE c.id = _company_id;
  _digits := regexp_replace(coalesce(_phone, ''), '\D', '', 'g');
  IF length(_digits) < 9 OR length(trim(coalesce(_name, ''))) < 1 THEN
    RETURN jsonb_build_object('error', '이름·전화번호가 올바르지 않습니다');
  END IF;

  PERFORM public.process_signup_company_selection(_user_id, _project_id, _company_id, 'WORKER');

  SELECT id INTO _worker_id
  FROM public.workers
  WHERE project_id = _project_id
    AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') = _digits
  LIMIT 1;

  IF _worker_id IS NULL THEN
    INSERT INTO public.workers (
      project_id, name, phone, company_id, company_name, job_type, is_active, hire_date
    ) VALUES (
      _project_id,
      trim(_name),
      _digits,
      _company_id,
      coalesce(_company_name, ''),
      nullif(trim(coalesce(_job_type, '')), ''),
      true,
      CURRENT_DATE
    )
    RETURNING id INTO _worker_id;
  ELSE
    UPDATE public.workers
    SET name = trim(_name),
        company_id = _company_id,
        company_name = coalesce(_company_name, company_name),
        job_type = coalesce(nullif(trim(coalesce(_job_type, '')), ''), job_type),
        is_active = true
    WHERE id = _worker_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'worker_id', _worker_id);
END $$;

GRANT EXECUTE ON FUNCTION public.complete_worker_roster_signup(uuid, uuid, uuid, text, text, text) TO authenticated, service_role;
