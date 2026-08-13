-- SafeNex: permit_sig_key_for_position — closure_supervisor stamp
-- Paste into Supabase SQL Editor and Run.

CREATE OR REPLACE FUNCTION public.permit_sig_key_for_position(_position text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $body$
  SELECT CASE lower(COALESCE(_position, ''))
    WHEN 'contractor_supervisor' THEN 'contractor_pic'
    WHEN 'contractor_pic' THEN 'contractor_pic'
    WHEN 'contractor_safety_manager' THEN 'safety_pic'
    WHEN 'safety_pic' THEN 'safety_pic'
    WHEN 'contractor_site_director' THEN 'site_director'
    WHEN 'site_director' THEN 'site_director'
    WHEN 'site_supervisor' THEN 'site_supervisor'
    WHEN 'closure_supervisor' THEN 'site_supervisor'
    WHEN 'gc' THEN 'gc_manager'
    WHEN 'gc_manager' THEN 'gc_manager'
    WHEN 'gc_pm' THEN 'gc_manager'
    WHEN 'owner_cm' THEN 'cm'
    WHEN 'cm' THEN 'cm'
    WHEN 'owner_sm' THEN 'sm'
    WHEN 'sm' THEN 'sm'
    WHEN 'closure_sm' THEN 'closure_approver'
    WHEN 'extend_sm' THEN 'extension_approver'
    ELSE NULL
  END;
$body$;
