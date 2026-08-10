/**
 * Shared crew-align policy for work permits ↔ TBM / on-site sync.
 * Keep free of supabase so unit tests can import without env.
 */

export const EMPTY_ONSITE_CREW_GUARD =
  "오늘 실출근(미퇴근) 기록이 없어 명단을 비우지 않았습니다. 예상 배정을 유지하고 TBM과 맞춥니다.";

export const EMPTY_SCOPED_ONSITE_GUARD =
  "오늘 실출근자 중 이 허가서 소속 회사가 없어 명단을 비우지 않았습니다.";

export const EMPTY_TBM_CREW_GUARD =
  "TBM 참석자가 없어 허가서 명단을 비우지 않았습니다. 예상 배정을 유지하세요.";

/** Pure guard — do not replace permit crew with an empty list. */
export function shouldRefuseEmptyCrewReplace(nextCount: number): boolean {
  return nextCount <= 0;
}
