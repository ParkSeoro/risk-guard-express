/** One JPEG from the live player, for the viewer snapshot and for later safety analysis. */
export type VisionFrameCapture = {
  blob: Blob;
  width: number;
  height: number;
  capturedAt: string;
};

/**
 * Grab the current picture. Later unsafe-situation analysis should call this
 * on the same `<video>` the viewer is showing. Do not open a second stream.
 */
export function captureVideoFrame(video: HTMLVideoElement): Promise<Blob | null> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, width, height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.92);
  });
}

export async function captureVisionFrame(video: HTMLVideoElement): Promise<VisionFrameCapture | null> {
  const blob = await captureVideoFrame(video);
  if (!blob) return null;
  return {
    blob,
    width: video.videoWidth,
    height: video.videoHeight,
    capturedAt: new Date().toISOString(),
  };
}
