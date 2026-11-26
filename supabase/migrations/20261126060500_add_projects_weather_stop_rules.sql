-- Add nullable per-project weather stop-work criteria (falls back to statutory KOSHA defaults when null)

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS weather_stop_rules jsonb;

COMMENT ON COLUMN public.projects.weather_stop_rules IS 'Project-specific weather stop-work thresholds (craneWindMs, highWorkWindMs, rainMmPerHour, heatCautionC, heatStopC, coldCautionC, coldStopC)';
