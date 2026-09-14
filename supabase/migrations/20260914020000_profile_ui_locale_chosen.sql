-- Distinguish "already using Korean" from "has not picked a language yet".
-- Existing rows are marked chosen so current Korean workers never see the gate.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ui_locale_chosen boolean NOT NULL DEFAULT false;

UPDATE public.profiles
SET ui_locale_chosen = true
WHERE ui_locale_chosen IS NOT TRUE;
