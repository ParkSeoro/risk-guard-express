-- Fix push dispatch target URL to the live SafeNex project.
-- Old seed pointed at legacy Lovable project (iqtiozscqwuacgzrlfzu).
UPDATE private.dispatch_config
SET value = 'https://qhntxmggacorqjjmjqgo.supabase.co'
WHERE key = 'supabase_url'
  AND value IS DISTINCT FROM 'https://qhntxmggacorqjjmjqgo.supabase.co';

-- Ensure trigger_secret exists (paired with Edge PUSH_TRIGGER_SECRET).
INSERT INTO private.dispatch_config(key, value) VALUES
  ('trigger_secret', '07b47bf2d089c5a362567a90f354e9f88c1f9244ff41210c482612e94bb7d67a')
ON CONFLICT (key) DO NOTHING;
