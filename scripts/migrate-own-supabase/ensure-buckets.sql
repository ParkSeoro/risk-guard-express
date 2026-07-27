-- Idempotent storage buckets for a fresh (own) Supabase project.
-- Lovable Cloud often created some of these outside migrations.
-- Run in Dashboard → SQL Editor AFTER relying on file uploads.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('attachments', 'attachments', true, NULL, NULL),
  ('project-library', 'project-library', false, NULL, NULL),
  ('permit-form-assets', 'permit-form-assets', false, NULL, NULL),
  ('app-updates', 'app-updates', false, NULL, NULL)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  name = EXCLUDED.name;
