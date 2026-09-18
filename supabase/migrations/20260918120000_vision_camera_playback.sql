-- Browser-playable live URLs for the 4-pane vision wall. RTSP is never stored here.

ALTER TABLE public.vision_cameras
  ADD COLUMN IF NOT EXISTS playback_url text;

ALTER TABLE public.vision_stream_grants
  ALTER COLUMN action SET DEFAULT 'live_mainstream';

ALTER TABLE public.vision_stream_grants
  ALTER COLUMN max_bitrate_kbps SET DEFAULT 4096;
