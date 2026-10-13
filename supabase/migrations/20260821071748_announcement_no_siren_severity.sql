-- Clear siren-triggering severity on already-sent announcement rows.
UPDATE public.notifications
   SET severity = NULL
 WHERE type = 'announcement'
   AND severity IN ('high', 'critical', 'danger');

-- Patch only the severity expression in live RPCs via CREATE OR REPLACE from repo migration body.
-- (Full function bodies applied via next tool call if needed — first clear data.)
SELECT count(*)::int AS cleared FROM public.notifications WHERE type='announcement' AND severity IS NULL;
