/** 현장 공사정보의 공종. 토목은 기술지도 상한(150억)을 가르고, 터널·지하·밀폐는 법적 업무 측정 항목에 쓰인다. */
export const CONSTRUCTION_TYPE_OPTIONS = [
  '건축',
  '토목',
  '설비',
  '전기',
  '해체',
  '터널/지하/밀폐',
] as const;

export type ConstructionTypeOption = (typeof CONSTRUCTION_TYPE_OPTIONS)[number];

export function isCivilConstruction(raw?: string | null): boolean {
  return String(raw || '').includes('토목');
}
