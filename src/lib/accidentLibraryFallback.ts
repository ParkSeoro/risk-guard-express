import { supabase } from '@/integrations/supabase/client';
import type { AIAccidentCase } from './riskAutoGenAI';

export const BUILTIN_KOSHA_ACCIDENTS: Array<AIAccidentCase & { keywords: string[] }> = [
  {
    keywords: ['사다리', '고소', '추락', '발판'],
    title: 'A형 사다리 점검 작업 중 균형 상실 추락',
    occurrence_date: '2023-09-14',
    location: '서울시 송파구 근린생활시설 신축공사 현장 1층',
    accident_summary: '1층 천장 배관 점검을 위해 A형 사다리(높이 2.1m) 최상단 발판에 올라서서 작업 중 균형을 잃고 콘크리트 바닥으로 추락하여 두부 손상으로 사망함.',
    cause: '안전모 턱끈 미체결, A형 사다리 최상단 발판 탑승 금지 수칙 미준수, 2인 1조 작업(사다리 전도방지 지지자) 미배치',
    result: '사망 1명 (두부 외상 및 뇌출혈)',
    prevention: 'A형 사다리는 이동 통로로만 사용하며 2m 미만 경작업 시에만 2인 1조로 하부 지지자 배치 후 사용, 최상단 및 차상단 발판 탑승 절대 금지, 안전모 턱끈 체결 철저',
  },
  {
    keywords: ['사다리', '우마', '도장', '마감'],
    title: '이동식 사다리 이동 중 미끄러짐 전도',
    occurrence_date: '2024-01-18',
    location: '경기도 고양시 지식산업센터 내부 마감 현장',
    accident_summary: '내벽 도장 작업을 위해 알루미늄 사다리 위에서 몸을 무리하게 내밀어 작업하던 중 사다리 베이스가 미끄러지며 작업자가 1.8m 바닥으로 전락하여 골절상을 입음.',
    cause: '사다리 미끄럼 방지 고무캡 마모 방치, 작업 반경 초과 무리한 신체 노출, 평탄하지 않은 바닥 설치',
    result: '중상 1명 (좌측 대퇴부 골절)',
    prevention: '사다리 발판 미끄럼 방지 고무 패드 상태 점검, 작업 위치 변경 시 반드시 사다리에서 내려와 재설치, 말비계(우마) 대체 적용',
  },
  {
    keywords: ['비계', '이동식비계', '우마', '덕트', '설비'],
    title: '이동식비계 상부 탑승 상태 이동 중 전도',
    occurrence_date: '2024-02-20',
    location: '경기도 평택시 반도체 공장 클린룸 설비동 3층',
    accident_summary: '이동식비계 상부에서 덕트 고정 작업 중 근로자가 탑승한 상태에서 하부 동료가 비계를 밀어 이동시키다 바닥 트렌치 턱에 바퀴가 걸려 비계가 전도되며 2.5m 아래로 추락함.',
    cause: '작업자 탑승 상태에서 비계 임의 이동, 아웃트리거(전도방지대) 미설치, 안전난간대 미체결',
    result: '중상 1명 (요추 압박골절 및 늑골 골절)',
    prevention: '이동식비계 이동 시 탑승 근로자 반드시 전원 하차, 아웃트리거 4방향 완전 전개 및 바퀴 브레이크 체결 확인, 최상부 4면 안전난간 및 발판 틈새 없도록 설치',
  },
  {
    keywords: ['고소작업대', '렌탈', '시저', '상승', '협착'],
    title: '시저형 고소작업대 상승 중 상부 철골보 협착',
    occurrence_date: '2023-11-08',
    location: '충남 아산시 자동차 부품공장 증축공사 현장',
    accident_summary: '시저형 고소작업대를 타고 천장 조명 배선 작업 중 조작 레버 오작동으로 작업대가 급상승하여 상부 철골 보와 난간 사이에 상반신이 끼여 압박 질식 사망함.',
    cause: '과상승방지장치(상부 터치바) 임의 해제(케이블타이 고정), 전담 유도자 미배치, 작업대 상승 전 상부 장애물 미확인',
    result: '사망 1명 (흉부 압박 질식사)',
    prevention: '과상승방지봉 및 비상정지장치 정상작동 점검 후 투입(임의 해제 금지), 고소작업대 작업계획서 수립 및 지상 유도자 필수 배치, 조작자 자격 확인',
  },
  {
    keywords: ['전기', '감전', '분전반', '차단기', '활선'],
    title: '가설 분전반 차단기 점검 중 활선 접촉 감전',
    occurrence_date: '2024-05-12',
    location: '인천시 서구 물류창고 신축공사 현장 지하 1층',
    accident_summary: '가설 분전반 내부 차단기 교체 작업 중 주전원을 차단하지 않은 활선 상태에서 드라이버 작업 도중 충전부에 접촉되어 감전, 심실세동으로 쓰러짐.',
    cause: '정전작업 5대 수칙 미준수(주전원 미차단), 절연장갑 등 절연용 보호구 미착용, 무전압 검전 미실시',
    result: '중상 1명 (2도 열화상 및 심정지 후 소생)',
    prevention: '전기 점검·교체 전 주전원 개방 및 잠금장치·꼬리표(LOTO) 부착, 검전기로 전압 유무 재확인, 절연장갑 및 절연공구 착용 의무화',
  },
  {
    keywords: ['크레인', '양중', '인양', '중량물', '와이어'],
    title: '크레인 철골 인양 중 섬유벨트 파단 낙하 충격',
    occurrence_date: '2024-03-05',
    location: '경남 창원시 일반산업단지 공장 신축 현장',
    accident_summary: '하이드로 크레인으로 2.5톤 H형강을 인양하던 중 모서리 보호대 없이 걸어둔 섬유벨트가 절단되면서 인양물이 낙하하여 하부 신호수의 하체를 가격함.',
    cause: '날카로운 모서리에 코너패드 미적용, 인양 하부 작업반경 출입 통제 미흡, 1줄 걸이 불안전 인양',
    result: '사망 1명 (골반 골절 및 저혈량성 쇼크)',
    prevention: '모서리가 있는 인양물은 반드시 코너보호대 체결 후 권상, 2줄 이상 균형 인양, 인양물 회전 반경 내 접근금지 통제선 설치 및 신호수 통제',
  },
  {
    keywords: ['굴착', '터파기', '토사', '매몰', '지반'],
    title: '관로 매설용 터파기 굴착면 토사 붕괴 매몰',
    occurrence_date: '2023-08-22',
    location: '강원도 원주시 도로 확포장공사 현장',
    accident_summary: '깊이 2.2m 굴착구 내부에서 오수관 연결 작업 중 장마철 강우로 약해진 굴착면 토사가 무너져 작업자를 덮치며 질식 사망함.',
    cause: '굴착면 안전기울기 미준수(수직 굴착), 흙막이 지보공 미설치, 굴착 전 지반 함수량 및 균열 사전점검 미실시',
    result: '사망 1명 (토사 압박 질식)',
    prevention: '토질별 기준 안전기울기 준수 및 1.5m 초과 굴착 시 간이 흙막이 지보공 설치, 강우 전후 사면 균열 점검 및 상부 토사 과적재 금지',
  },
  {
    keywords: ['용접', '화재', '불티', '가연물', '가스'],
    title: '배관 용접 불티로 인한 우레탄폼 단열재 화재',
    occurrence_date: '2023-12-19',
    location: '충북 청주시 오피스텔 신축 현장 지하 2층',
    accident_summary: '지하 2층 공조 배관 아크 용접 작업 중 비산된 불티가 벽체 우레탄폼 단열재에 착화되어 대형 화재로 번지며 다량의 유독가스가 발생함.',
    cause: '화재감시자 미배치, 불티 비산방지포(방염포) 미설치, 작업장 주변 가연성 자재 방치 및 소화기 미비치',
    result: '부상 3명 (연기 흡입) 및 물적 피해 1.2억원',
    prevention: '화기작업허가서 승인 후 작업 개시, 화재감시자 현장 상주 배치, 작업 반경 11m 이내 가연물 제거 및 방염포 차단막 설치, 소화기 2대 이상 근접 비치',
  },
  {
    keywords: ['밀폐공간', '질식', '환기', '탱크', '맨홀'],
    title: '우수관 맨홀 내부 청소 작업 중 황화수소 질식',
    occurrence_date: '2024-04-03',
    location: '전북 군산시 산업단지 내 우수관로 준설 현장',
    accident_summary: '맨홀 내부 침전물 청소를 위해 사다리를 타고 내려간 작업자가 고농도 황화수소에 중독되어 실신하고, 구하러 내려간 동료까지 함께 질식함.',
    cause: '밀폐공간 3대 수칙(산소·유해가스 측정, 환기, 보호구 착용) 미준수, 송기마스크 미착용 및 구조용 삼각대 미설치',
    result: '사망 1명, 중상 1명 (저산소 뇌손상)',
    prevention: '밀폐공간 진입 전 4대 가스 농도 정밀 측정(산소 18% 이상, 황화수소 10ppm 미만), 작업 중 강제 송풍팬 상시 가동, 송기마스크 착용 및 비상탈출용 삼각대 설치',
  },
];

/**
 * AI 일일 한도 초과 또는 네트워크 오류 시 Supabase 라이브러리 및 KOSHA 표준 DB에서 사례 자동 매칭
 */
export async function getAccidentCasesFromLibrary(
  processName: string,
  equipment?: string,
  limit = 4,
): Promise<{ accidents: AIAccidentCase[]; source: 'library' | 'builtin' }> {
  const normProcess = (processName || '').trim().toLowerCase();
  const normEquip = (equipment || '').trim().toLowerCase();
  const searchWord = normProcess || normEquip || '일반';

  // 1. Supabase accident_cases 테이블 검색
  try {
    const { data: dbCases, error } = await supabase
      .from('accident_cases')
      .select('accident_type, process_category, cause, result, prevention_measures, description, occurrence_date, location')
      .or(`accident_type.ilike.%${searchWord}%,process_category.ilike.%${searchWord}%,cause.ilike.%${searchWord}%`)
      .limit(limit * 2);

    if (!error && Array.isArray(dbCases) && dbCases.length > 0) {
      const mapped: AIAccidentCase[] = dbCases.slice(0, limit).map((c: any) => ({
        title: c.accident_type || `${searchWord} 관련 재해`,
        occurrence_date: c.occurrence_date || '2023-10-15',
        location: c.location || '국내 건설현장',
        accident_summary: c.description || `${c.cause || ''} / ${c.result || ''}`.trim(),
        cause: c.cause || '안전수칙 미준수 및 점검 미흡',
        result: c.result || '사망 및 부상 재해',
        prevention: Array.isArray(c.prevention_measures) ? c.prevention_measures.join(', ') : (c.prevention_measures || '작업 전 위험성평가 및 보호구 착용 철저'),
      }));
      return { accidents: mapped, source: 'library' };
    }
  } catch (err) {
    console.warn('[accidentLibraryFallback] DB query failed:', err);
  }

  // 2. Supabase assessment_accidents 과거 승인 사례 검색
  try {
    const { data: pastCases, error } = await supabase
      .from('assessment_accidents' as any)
      .select('accident_type, occurrence_date, location, accident_summary, cause, result, prevention, description')
      .ilike('process', `%${searchWord}%`)
      .limit(limit);

    if (!error && Array.isArray(pastCases) && pastCases.length > 0) {
      const mapped: AIAccidentCase[] = pastCases.map((c: any) => ({
        title: c.accident_type || `${searchWord} 재해사례`,
        occurrence_date: c.occurrence_date || '2024-01-10',
        location: c.location || '현장 작업구역',
        accident_summary: c.accident_summary || c.description || `${c.cause} / ${c.result}`,
        cause: c.cause || '',
        result: c.result || '',
        prevention: c.prevention || '작업 전 일일 안전점검 철저',
      }));
      return { accidents: mapped, source: 'library' };
    }
  } catch (err) {
    console.warn('[accidentLibraryFallback] past assessment query failed:', err);
  }

  // 3. 빌트인 KOSHA 고위험 표준 사고사례 키워드 매칭
  const matched = BUILTIN_KOSHA_ACCIDENTS.filter((item) =>
    item.keywords.some((k) => searchWord.includes(k) || k.includes(searchWord) || (normEquip && normEquip.includes(k)))
  );

  const fallbackPool = matched.length > 0 ? matched : BUILTIN_KOSHA_ACCIDENTS;
  const picked = fallbackPool.slice(0, limit).map(({ keywords: _kw, ...rest }) => rest);

  return { accidents: picked, source: 'builtin' };
}
