/** Keep remaining saved URLs and append newly uploaded ones. */
export function mergeKeptAndUploaded(kept: string[], uploaded: string[]): string[] {
  return [...(kept || []), ...(uploaded || [])].map((url) => String(url || "").trim()).filter(Boolean);
}

export function removeAtIndex<T>(items: T[], index: number): T[] {
  return (items || []).filter((_, i) => i !== index);
}

export function feedbackPhotoRequirement(opts: {
  status: string;
  keptBefore: string[];
  newBeforeCount: number;
  keptAfter: string[];
  newAfterCount: number;
}): { ok: boolean; error?: string } {
  const beforeCount = (opts.keptBefore?.length || 0) + (opts.newBeforeCount || 0);
  if (beforeCount === 0) {
    return { ok: false, error: "조치 전(Before) 사진은 필수입니다." };
  }
  if (opts.status === "완료" && (opts.keptAfter?.length || 0) + (opts.newAfterCount || 0) === 0) {
    return { ok: false, error: "완료 처리 시 조치 후(After) 사진이 필수입니다." };
  }
  return { ok: true };
}
