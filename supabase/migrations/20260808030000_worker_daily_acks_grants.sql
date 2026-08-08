-- Ensure worker_daily_acks is usable by authenticated clients (table may exist without grants).
GRANT SELECT, INSERT, UPDATE ON public.worker_daily_acks TO authenticated;
GRANT ALL ON public.worker_daily_acks TO service_role;
