-- The direct anon INSERT policy allowed anyone to submit worker PII (name, phone, company)
-- into hazard_survey_responses for any active survey without validating the QR token.
-- The application already routes anonymous submissions through the SECURITY DEFINER RPC
-- `public.submit_hazard_survey_response(_qr_token, ...)`, so the direct policy is dead code.
-- Dropping it closes the PII-spam / fabrication vector.
DROP POLICY IF EXISTS "hsr_insert_via_active_survey" ON public.hazard_survey_responses;

-- Ensure anon has no direct write privilege on the table (RPC uses definer rights).
REVOKE INSERT ON public.hazard_survey_responses FROM anon;