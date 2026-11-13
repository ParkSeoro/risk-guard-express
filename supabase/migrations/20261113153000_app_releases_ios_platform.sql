-- iPhone reads an ios row, then shared. It never reads android or desktop.
-- Existing android and desktop rows are not updated. The copied ios row
-- keeps min_native_version empty so Play's floor cannot block an iPhone.

ALTER TABLE public.app_releases
  DROP CONSTRAINT IF EXISTS app_releases_platform_check;

ALTER TABLE public.app_releases
  ADD CONSTRAINT app_releases_platform_check
  CHECK (platform IN ('android', 'desktop', 'shared', 'ios'));

INSERT INTO public.app_releases (
  version,
  channel,
  platform,
  bundle_url,
  checksum,
  mandatory,
  min_native_version,
  notes,
  released_at,
  is_deleted
)
SELECT
  src.version,
  src.channel,
  'ios',
  src.bundle_url,
  src.checksum,
  src.mandatory,
  NULL,
  src.notes,
  src.released_at,
  false
FROM (
  SELECT DISTINCT ON (channel)
    version,
    channel,
    bundle_url,
    checksum,
    mandatory,
    notes,
    released_at
  FROM public.app_releases
  WHERE is_deleted = false
    AND platform = 'android'
  ORDER BY channel, released_at DESC
) src
WHERE NOT EXISTS (
  SELECT 1
  FROM public.app_releases existing
  WHERE existing.channel = src.channel
    AND existing.version = src.version
    AND existing.platform = 'ios'
);

CREATE OR REPLACE FUNCTION public.get_latest_app_release(
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
      OR (q.platform = 'ios' AND r.platform IN ('ios', 'shared'))
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
  'Latest OTA row. An omitted platform sees android and shared only. android prefers an android row, then shared. desktop prefers a desktop row, then shared, and never an android row. ios prefers an ios row, then shared, and never an android or desktop row.';
