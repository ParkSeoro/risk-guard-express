
-- 1) Storage: allow project members to upload/view/delete attachments under {project_id}/...
DROP POLICY IF EXISTS "Authenticated can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Owner can delete attachments" ON storage.objects;
DROP POLICY IF EXISTS "Owner can view attachments" ON storage.objects;

CREATE POLICY "Project members can upload attachments"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND (
      public.is_project_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

CREATE POLICY "Project members can update attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      public.is_project_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

CREATE POLICY "Project members can delete attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND (
      public.is_project_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

-- 2) Update register_worker to accept optional company_id (from QR)
CREATE OR REPLACE FUNCTION public.register_worker(
  _project_id uuid, _name text, _phone text,
  _company_name text, _company_id uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _existing record;
  _new_id UUID;
  _new_token TEXT;
  _resolved_company_id UUID := _company_id;
  _resolved_company_name TEXT := COALESCE(NULLIF(trim(_company_name), ''), '');
BEGIN
  IF _name IS NULL OR length(trim(_name)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_NAME');
  END IF;
  IF _phone IS NULL OR length(trim(_phone)) < 8 THEN
    RETURN jsonb_build_object('error', 'INVALID_PHONE');
  END IF;

  -- If company_id provided, resolve its name
  IF _resolved_company_id IS NOT NULL THEN
    SELECT name INTO _resolved_company_name FROM public.companies
     WHERE id = _resolved_company_id AND project_id = _project_id;
    IF _resolved_company_name IS NULL THEN
      _resolved_company_id := NULL;
      _resolved_company_name := COALESCE(NULLIF(trim(_company_name),''), '');
    END IF;
  END IF;

  -- Otherwise try to match by name
  IF _resolved_company_id IS NULL AND _resolved_company_name <> '' THEN
    SELECT id INTO _resolved_company_id FROM public.companies
     WHERE project_id = _project_id AND name = _resolved_company_name LIMIT 1;
  END IF;

  SELECT id, qr_token INTO _existing FROM public.workers
   WHERE project_id = _project_id AND phone = trim(_phone) LIMIT 1;

  IF FOUND THEN
    UPDATE public.workers
       SET name = trim(_name),
           company_name = _resolved_company_name,
           company_id = COALESCE(_resolved_company_id, company_id),
           is_active = true,
           updated_at = now()
     WHERE id = _existing.id;
    RETURN jsonb_build_object('success', true, 'worker_id', _existing.id, 'qr_token', _existing.qr_token);
  END IF;

  INSERT INTO public.workers (project_id, company_id, company_name, name, phone)
  VALUES (_project_id, _resolved_company_id, _resolved_company_name, trim(_name), trim(_phone))
  RETURNING id, qr_token INTO _new_id, _new_token;

  RETURN jsonb_build_object('success', true, 'worker_id', _new_id, 'qr_token', _new_token);
END;
$function$;
