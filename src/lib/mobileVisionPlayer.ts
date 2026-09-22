export type MobileVisionCamera = {
  id: string;
  camera_id: string;
  name: string;
  health_state: string | null;
  playback_url?: string | null;
  created_at?: string | null;
};

/** Keep one selected camera; fall back to the first if the id is gone. */
export function selectedMobileVisionCamera<T extends { id: string }>(
  cameras: T[],
  selectedId: string | null,
): T | null {
  if (cameras.length === 0) return null;
  return cameras.find((camera) => camera.id === selectedId) ?? cameras[0];
}
