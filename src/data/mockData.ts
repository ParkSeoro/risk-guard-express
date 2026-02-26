import type { Project, RiskItem, MasterProcess, MasterPPE, MasterLegalBasis, MasterDepartment, MasterAssignee, ApprovalStep } from '@/types';

export const masterProcesses: MasterProcess[] = [
  { id: 'p1', name: '배관설치', category: '기계' },
  { id: 'p2', name: '용접작업', category: '기계' },
  { id: 'p3', name: '고소작업', category: '건축' },
  { id: 'p4', name: '중장비 운반', category: '토목' },
  { id: 'p5', name: '전기배선', category: '전기' },
  { id: 'p6', name: '도장작업', category: '마감' },
  { id: 'p7', name: '6000t Tank 설치', category: '기계' },
  { id: 'p8', name: 'Cooling Tower 설치', category: '기계' },
  { id: 'p9', name: '굴착작업', category: '토목' },
  { id: 'p10', name: '철골조립', category: '건축' },
];

export const masterPPE: MasterPPE[] = [
  { id: 'ppe1', name: '안전모' },
  { id: 'ppe2', name: '안전화' },
  { id: 'ppe3', name: '안전대(하네스)' },
  { id: 'ppe4', name: '보안경' },
  { id: 'ppe5', name: '용접면' },
  { id: 'ppe6', name: '방진마스크' },
  { id: 'ppe7', name: '귀마개' },
  { id: 'ppe8', name: '안전장갑' },
  { id: 'ppe9', name: '방독마스크' },
  { id: 'ppe10', name: '안전조끼' },
];

export const masterLegalBasis: MasterLegalBasis[] = [
  { id: 'law1', code: '산업안전보건법 제36조', description: '위험성평가 실시' },
  { id: 'law2', code: '산업안전보건법 제38조', description: '안전조치' },
  { id: 'law3', code: '산업안전보건법 제39조', description: '보건조치' },
  { id: 'law4', code: '산업안전보건기준규칙 제42조', description: '추락의 방지' },
  { id: 'law5', code: '산업안전보건기준규칙 제171조', description: '차량계 하역운반기계 운전' },
  { id: 'law6', code: '산업안전보건기준규칙 제302조', description: '폭발위험장소' },
  { id: 'law7', code: '화학물질관리법 제24조', description: '유해화학물질 취급기준' },
];

export const masterDepartments: MasterDepartment[] = [
  { id: 'd1', name: '안전환경팀' },
  { id: 'd2', name: '공무팀' },
  { id: 'd3', name: '기계팀' },
  { id: 'd4', name: '전기팀' },
  { id: 'd5', name: '품질팀' },
];

export const masterAssignees: MasterAssignee[] = [
  { id: 'a1', name: '김안전', departmentId: 'd1', position: '팀장', phone: '010-1234-5678' },
  { id: 'a2', name: '이현장', departmentId: 'd2', position: '소장', phone: '010-2345-6789' },
  { id: 'a3', name: '박기계', departmentId: 'd3', position: '과장', phone: '010-3456-7890' },
  { id: 'a4', name: '최전기', departmentId: 'd4', position: '대리', phone: '010-4567-8901' },
  { id: 'a5', name: '정품질', departmentId: 'd5', position: '차장', phone: '010-5678-9012' },
  { id: 'a6', name: '한보건', departmentId: 'd1', position: '대리', phone: '010-6789-0123' },
];

export const sampleProject: Project = {
  id: 'proj1',
  name: 'LGC 여수 배관망 증설 공사',
  siteName: 'LGC 여수 배관망 증설 현장',
  period: { start: '2026-01-15', end: '2026-12-31' },
  client: 'LG화학',
  contractor: '(주)한국건설',
  subcontractors: ['(주)대한배관', '(주)우리용접', '(주)성일전기'],
  tags: ['6000t Tank', 'Cooling Tower', '배관'],
  status: '진행중',
};

export const sampleRiskItems: RiskItem[] = [
  {
    id: 'r1', projectId: 'proj1', process: '배관설치', subTask: '대구경 배관 운반 및 거치',
    hazard: '중량물 낙하', hazardSituation: '크레인 인양 중 와이어 파단으로 배관 낙하',
    existingMeasure: '작업반경 출입통제, 신호수 배치', improvementMeasure: '와이어로프 일일 점검표 도입, 인양경로 사전 시뮬레이션',
    frequency: 3, severity: 5, risk: 15, improvedFrequency: 2, improvedSeverity: 5, improvedRisk: 10,
    status: '진행', ppe: ['안전모', '안전화', '안전조끼'], legalBasis: ['산업안전보건법 제38조'],
    department: '기계팀', assignee: '박기계', note: '3월 중 개선 완료 예정', attachments: [],
  },
  {
    id: 'r2', projectId: 'proj1', process: '용접작업', subTask: '배관 맞대기 용접',
    hazard: '화재·폭발', hazardSituation: '용접 불꽃이 인근 가연물에 착화',
    existingMeasure: '소화기 비치, 용접작업 허가제', improvementMeasure: '화기감시자 상시 배치, 불꽃 비산방지 덮개 설치',
    frequency: 4, severity: 5, risk: 20, improvedFrequency: 2, improvedSeverity: 5, improvedRisk: 10,
    status: '미착수', ppe: ['용접면', '안전장갑', '안전화'], legalBasis: ['산업안전보건기준규칙 제302조'],
    department: '기계팀', assignee: '박기계', note: '', attachments: [],
  },
  {
    id: 'r3', projectId: 'proj1', process: '고소작업', subTask: 'Tank 외벽 비계 설치',
    hazard: '추락', hazardSituation: '비계 설치 중 안전대 미체결 상태에서 추락',
    existingMeasure: '안전대 착용 의무화, 안전난간 설치', improvementMeasure: '수직구명줄 추가 설치, 추락방지망 보강',
    frequency: 3, severity: 5, risk: 15, improvedFrequency: 1, improvedSeverity: 5, improvedRisk: 5,
    status: '완료', ppe: ['안전모', '안전대(하네스)', '안전화'], legalBasis: ['산업안전보건기준규칙 제42조'],
    department: '안전환경팀', assignee: '김안전', note: '2월 완료', attachments: [],
  },
  {
    id: 'r4', projectId: 'proj1', process: '중장비 운반', subTask: '25톤 크레인 이동',
    hazard: '접촉·충돌', hazardSituation: '작업장 내 크레인 이동 시 보행자 충돌',
    existingMeasure: '유도자 배치, 이동경로 안내', improvementMeasure: '이동경로 분리 펜스 설치, 경광등 부착',
    frequency: 3, severity: 4, risk: 12, improvedFrequency: 2, improvedSeverity: 4, improvedRisk: 8,
    status: '진행', ppe: ['안전모', '안전조끼'], legalBasis: ['산업안전보건기준규칙 제171조'],
    department: '공무팀', assignee: '이현장', note: '', attachments: [],
  },
  {
    id: 'r5', projectId: 'proj1', process: '전기배선', subTask: '고압케이블 포설',
    hazard: '감전', hazardSituation: '활선 근접 작업 시 감전',
    existingMeasure: '정전작업 원칙, 절연장갑 착용', improvementMeasure: '활선접근경보기 도입, 작업 전 전압 측정 의무화',
    frequency: 2, severity: 5, risk: 10, improvedFrequency: 1, improvedSeverity: 5, improvedRisk: 5,
    status: '미착수', ppe: ['안전모', '안전장갑', '보안경'], legalBasis: ['산업안전보건법 제38조'],
    department: '전기팀', assignee: '최전기', note: '', attachments: [],
  },
  {
    id: 'r6', projectId: 'proj1', process: '도장작업', subTask: '탱크 내부 방식 도장',
    hazard: '유기용제 중독', hazardSituation: '밀폐공간 내 유기용제 증기 흡입',
    existingMeasure: '환기장치 가동, 방독마스크 착용', improvementMeasure: '산소농도 연속측정기 설치, 밀폐공간 출입허가제 강화',
    frequency: 3, severity: 4, risk: 12, improvedFrequency: 1, improvedSeverity: 4, improvedRisk: 4,
    status: '미착수', ppe: ['방독마스크', '보안경', '안전장갑'], legalBasis: ['산업안전보건법 제39조', '화학물질관리법 제24조'],
    department: '안전환경팀', assignee: '한보건', note: '', attachments: [],
  },
  {
    id: 'r7', projectId: 'proj1', process: '6000t Tank 설치', subTask: 'Tank 바닥판 용접',
    hazard: '화재·폭발', hazardSituation: 'Tank 내부 용접 시 잔류가스 폭발',
    existingMeasure: '가스농도 측정 후 작업', improvementMeasure: '실시간 가스감지기 설치, 비상대피 훈련 실시',
    frequency: 2, severity: 5, risk: 10, improvedFrequency: 1, improvedSeverity: 5, improvedRisk: 5,
    status: '진행', ppe: ['안전모', '용접면', '방독마스크', '안전대(하네스)'],
    legalBasis: ['산업안전보건기준규칙 제302조', '산업안전보건법 제38조'],
    department: '기계팀', assignee: '박기계', note: '가스감지기 발주 완료', attachments: [],
  },
  {
    id: 'r8', projectId: 'proj1', process: 'Cooling Tower 설치', subTask: '구조물 양중 작업',
    hazard: '중량물 낙하', hazardSituation: '양중 중 접합부 이탈로 구조물 낙하',
    existingMeasure: '양중계획서 작성, 작업반경 통제', improvementMeasure: '볼트 체결 토크 관리표 도입, 양중 시뮬레이션',
    frequency: 2, severity: 5, risk: 10, improvedFrequency: 1, improvedSeverity: 5, improvedRisk: 5,
    status: '미착수', ppe: ['안전모', '안전화', '안전대(하네스)'],
    legalBasis: ['산업안전보건법 제38조'],
    department: '기계팀', assignee: '박기계', note: '', attachments: [],
  },
];

export const sampleApprovals: ApprovalStep[] = [
  { id: 'ap1', riskItemId: 'r1', step: '작성', status: '승인', approver: '박기계', comment: '', timestamp: '2026-02-10 09:00' },
  { id: 'ap2', riskItemId: 'r1', step: '검토', status: '승인', approver: '김안전', comment: '양호', timestamp: '2026-02-11 14:30' },
  { id: 'ap3', riskItemId: 'r1', step: '승인', status: '대기', approver: '이현장', comment: '', timestamp: '' },
  { id: 'ap4', riskItemId: 'r3', step: '작성', status: '승인', approver: '김안전', comment: '', timestamp: '2026-02-01 10:00' },
  { id: 'ap5', riskItemId: 'r3', step: '검토', status: '승인', approver: '김안전', comment: '', timestamp: '2026-02-02 11:00' },
  { id: 'ap6', riskItemId: 'r3', step: '승인', status: '승인', approver: '이현장', comment: '승인', timestamp: '2026-02-03 09:00' },
];
