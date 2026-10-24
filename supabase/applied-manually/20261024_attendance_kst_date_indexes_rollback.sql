-- Drops the KST date expression indexes. Run each statement on its own,
-- outside a transaction. Does not change the attendance view.

DROP INDEX CONCURRENTLY IF EXISTS public.idx_wel_entry_kst_date;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tbm_part_kst_date;
