// 공종 자동 분해 엔진
// 입력 공종을 sub-process 배열로 분해하여 다양성을 확보한다.

const DECOMPOSITION_MAP: Record<string, string[]> = {
  "굴착": ["굴착", "토사 운반", "되메우기", "배수/물처리", "주변 정리"],
  "터널": ["막장 굴진", "버력 처리", "지보재 설치", "방수/배수", "환기"],
  "쉴드": ["세그먼트 조립", "추진/굴진", "이수/그라우팅", "버력 반출", "주입공 설치"],
  "tbm": ["커터 점검", "굴진", "세그먼트 조립", "버력 처리", "후방대차 이동"],
  "양중": ["줄걸이/슬링 점검", "신호 확인", "인양", "선회/이동", "안착/해체"],
  "고소": ["작업대 설치", "안전대 체결", "자재 운반", "본 작업", "정리/철거"],
  "용접": ["사전 환경 점검", "용접 본작업", "스패터 관리", "잔열 확인", "정리"],
  "밀폐": ["산소/유해가스 측정", "환기 설치", "감시인 배치", "본 작업", "비상 대피 훈련"],
  "전기": ["정전 절차", "검전/접지", "본 작업", "복전 점검", "정리"],
  "철근": ["가공", "운반", "조립/결속", "검사", "정리"],
  "거푸집": ["설치", "지지대 점검", "타설 입회", "해체", "정리"],
  "콘크리트": ["타설 준비", "타설", "다짐/마감", "양생", "정리"],
  "비계": ["기초 점검", "조립", "안전난간/발판 설치", "사용 중 점검", "해체"],
  "해체": ["사전 조사", "구조물 분리", "잔재 운반", "분진/소음 관리", "정리"],
  "도장": ["표면 처리", "혼합/조색", "도장 작업", "건조 관리", "정리"],
  "방수": ["바탕면 정리", "프라이머", "방수재 시공", "보호층", "검사"],
  "배관": ["가공/절단", "운반", "용접/접합", "수압 시험", "보온"],
  "굴착기": ["주행/이동", "굴착", "선회/적재", "정지/주차", "점검/정비"],
  "크레인": ["설치/세팅", "줄걸이 확인", "인양/선회", "안착", "철수"],
  "지게차": ["주행", "포크 작업", "적재/하역", "후진/방향전환", "정차/주차"],
};

export interface SubProcess {
  name: string;
  count: number;
}

/**
 * 공종명을 sub-process 배열로 분해하고 target_count를 균등 배분.
 * 매칭되는 분해 키가 없으면 원본 공종 1개로 반환.
 */
export function decomposeProcess(processName: string, targetCount: number): SubProcess[] {
  if (!processName || targetCount <= 0) {
    return [{ name: processName || "일반작업", count: targetCount }];
  }

  const lower = processName.toLowerCase();
  let matched: string[] | null = null;
  for (const [key, subs] of Object.entries(DECOMPOSITION_MAP)) {
    if (lower.includes(key.toLowerCase())) {
      matched = subs;
      break;
    }
  }

  if (!matched || matched.length === 0) {
    return [{ name: processName, count: targetCount }];
  }

  const per = Math.floor(targetCount / matched.length);
  const remainder = targetCount % matched.length;
  return matched.map((name, idx) => ({
    name: `${processName} - ${name}`,
    count: per + (idx < remainder ? 1 : 0),
  })).filter((s) => s.count > 0);
}
