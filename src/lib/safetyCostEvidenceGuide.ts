/**
 * 산업안전보건관리비 분류(1~9)별 권장·필수 증빙 안내
 * 근거: 건설업 산업안전보건관리비 계상 및 사용기준(고용노동부 고시) 취지
 */

export type EvidenceGuideItem = {
  code: string;
  name: string;
  requiredEvidence: string[];
  tips: string[];
};

export const SAFETY_COST_EVIDENCE_GUIDE: EvidenceGuideItem[] = [
  {
    code: '1',
    name: '안전·보건관리자 임금 등',
    requiredEvidence: ['급여명세서 또는 이체증', '안전·보건관리자 선임·지정 서류', '근무일지/근무확인서'],
    tips: ['일반 노무비·현장 기능공 임금과 구분되는지 확인', '본사 전담조직(8번)과 중복 계상 금지'],
  },
  {
    code: '2',
    name: '안전시설비 등',
    requiredEvidence: ['세금계산서/거래명세서', '설치·사용 위치 사진', '설치 위치·수량 확인 자료'],
    tips: ['일반 가설재·공사 자재와 구분', '방호장치·안전통로 등 재해예방 목적만'],
  },
  {
    code: '3',
    name: '보호구 등',
    requiredEvidence: ['거래명세서/세금계산서', '지급대장(수령자 서명)', '보호구 사진 또는 규격 증빙'],
    tips: ['개인 지급 내역이 있어야 함', '작업용 일반 공구·작업복만인 경우 제외 검토'],
  },
  {
    code: '4',
    name: '안전보건진단비 등',
    requiredEvidence: ['용역계약서 또는 견적·세금계산서', '진단·점검 결과보고서', '수행기관 자격 확인 자료'],
    tips: ['컨설팅·위험성평가 대행 등 목적 명시'],
  },
  {
    code: '5',
    name: '안전보건교육비 등',
    requiredEvidence: ['교육비 영수증/세금계산서', '교육일지·참석자 명단', '교재·강사비 증빙'],
    tips: ['회식·간식비는 교육비로 보기 어려움'],
  },
  {
    code: '6',
    name: '근로자 건강장해 예방비 등',
    requiredEvidence: ['건강진단/작업환경측정 결과 또는 계약·영수증', '휴게·온열 대응 시설 사진', '설치·사용 확인 자료'],
    tips: ['복리후생·식대와 구분'],
  },
  {
    code: '7',
    name: '건설재해예방 전문지도기관 기술지도비',
    requiredEvidence: ['기술지도 계약서', '지도일지/결과서', '세금계산서'],
    tips: ['등록된 전문지도기관인지 확인'],
  },
  {
    code: '8',
    name: '본사 전담조직 근로자 임금 등',
    requiredEvidence: ['본사 전담조직 구성·업무분장', '급여명세서/이체증', '현장 지원 업무 증빙'],
    tips: ['현장 안전관리자(1번)와 중복 계상 금지'],
  },
  {
    code: '9',
    name: '위험성평가 등에 따른 소요비용',
    requiredEvidence: ['위험성평가서 또는 개선조치 기록', '개선 비용 영수증', '조치 전·후 사진(해당 시)'],
    tips: ['일반 공사비·생산설비비와 구분'],
  },
];

export function getEvidenceGuide(categoryCode?: string | null): EvidenceGuideItem | null {
  if (!categoryCode) return null;
  return SAFETY_COST_EVIDENCE_GUIDE.find((g) => g.code === String(categoryCode)) || null;
}

export function evidenceGuideSummary(categoryCode?: string | null): string {
  const g = getEvidenceGuide(categoryCode);
  if (!g) return '분류를 선택하면 필요 증빙이 안내됩니다.';
  return `필요 증빙: ${g.requiredEvidence.join(' · ')}`;
}
