-- Phone and PC OTA rows share the zip on a normal publish, but each client
-- reads only its own platform. Existing rows stay `shared` so already
-- installed apps keep seeing them until the next publish.

ALTER TABLE public.app_releases
  ADD COLUMN IF NOT EXISTS platform text;

UPDATE public.app_releases
SET platform = 'shared'
WHERE platform IS NULL OR btrim(platform) = '';

ALTER TABLE public.app_releases
  ALTER COLUMN platform SET DEFAULT 'shared';

ALTER TABLE public.app_releases
  ALTER COLUMN platform SET NOT NULL;

ALTER TABLE public.app_releases
  DROP CONSTRAINT IF EXISTS app_releases_platform_check;

ALTER TABLE public.app_releases
  ADD CONSTRAINT app_releases_platform_check
  CHECK (platform IN ('android', 'desktop', 'shared'));

ALTER TABLE public.app_releases
  DROP CONSTRAINT IF EXISTS app_releases_channel_version_key;

ALTER TABLE public.app_releases
  DROP CONSTRAINT IF EXISTS app_releases_channel_version_platform_key;

ALTER TABLE public.app_releases
  ADD CONSTRAINT app_releases_channel_version_platform_key
  UNIQUE (channel, version, platform);

DROP FUNCTION IF EXISTS public.get_latest_app_release(text);

CREATE FUNCTION public.get_latest_app_release(
  _channel text DEFAULT 'stable',
  _platform text DEFAULT NULL
)
RETURNS TABLE (
  version text,
  channel text,
  bundle_url text,
  checksum text,
  mandatory boolean,
  min_native_version text,
  released_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH requested AS (
    SELECT
      COALESCE(NULLIF(btrim(_channel), ''), 'stable') AS channel,
      NULLIF(lower(btrim(COALESCE(_platform, ''))), '') AS platform
  )
  SELECT
    r.version,
    r.channel,
    r.bundle_url,
    r.checksum,
    r.mandatory,
    r.min_native_version,
    r.released_at
  FROM public.app_releases r
  CROSS JOIN requested q
  WHERE r.is_deleted = false
    AND r.channel = q.channel
    AND (
      (q.platform IS NULL AND r.platform IN ('android', 'shared'))
      OR (q.platform = 'android' AND r.platform IN ('android', 'shared'))
      OR (q.platform = 'desktop' AND r.platform IN ('desktop', 'shared'))
    )
    AND (
      q.platform IS NULL
      OR r.platform = q.platform
      OR NOT EXISTS (
        SELECT 1
        FROM public.app_releases exact
        WHERE exact.is_deleted = false
          AND exact.channel = q.channel
          AND exact.platform = q.platform
      )
    )
  ORDER BY
    CASE WHEN q.platform IS NOT NULL AND r.platform = q.platform THEN 0 ELSE 1 END,
    r.released_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_latest_app_release(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_app_release(text, text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_latest_app_release(text, text) IS
  'Latest OTA row. An omitted platform sees android and shared only. android prefers an android row, then shared. desktop prefers a desktop row, then shared, and never an android row.';
