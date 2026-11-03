export interface OfficialLetter {
  id: string;
  project_id?: string;
  doc_number: string; // e.g. "ALK Technology - Construction Safety - 26-01호" (발신) or "ALK-REC-26-01호" (수신)
  direction: '발신' | '수신';
  dispatch_date: string; // 발송일자 or 접수일자
  recipient: string; // 수신처
  reference: string; // 참조
  sender: string; // 발신처 / 발신자
  sender_department?: string;
  sender_title?: string;
  sender_name?: string;
  subject: string; // 제목
  content_paragraphs?: string[]; // 발신 공문 본문 단락
  sub_items_title?: string; // "- 아 래 -"
  sub_items?: Array<{ label: string; text: string; sub_bullets?: string[] }>;
  status: '작성중' | '팀장승인' | '발송완료' | '접수완료' | '조치중' | '처리완료' | '단순공람';
  attachments?: string;
  notes?: string;

  // 수신 공문 전용 처리 필드
  received_at?: string; // 접수일자 (YYYY-MM-DD)
  original_doc_number?: string; // 발신처 원 문서번호 (예: 여수지청 산재-124호)
  sender_organization?: string; // 발신 기관/회사명 (예: 고용노동부 여수지청)
  handling_due_date?: string; // 조치/회신 처리 마감일자
  handling_assignee?: string; // 담당자 (예: 박서로 차장)
  handling_status?: '접수' | '담당자배정' | '조치/회신중' | '처리완료' | '단순공람';
  action_taken?: string; // 현장 조치 내용 및 처리 결과
  reply_doc_number?: string; // 회신 발신 공문 번호 (예: ALK Technology - Construction Safety - 26-02호)
  attachment_url?: string; // 수신 공문 원본 파일 링크/URL
  attachment_name?: string; // 첨부 파일명

  created_at: string;
  updated_at: string;
}

export type PeriodicCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly';

export interface PeriodicTask {
  id: string;
  project_id?: string;
  cycle: PeriodicCycle;
  title: string;
  category: string;
  description: string;
  assignee: string;
  due_rule: string; // e.g. "매일 09:00", "매주 금요일", "매월 말일"
  due_date: string; // Current cycle target date
  status: 'pending' | 'in_progress' | 'completed';
  completed_at?: string;
  evidence_url?: string;
  notes?: string;
}

export interface SharedSheetRow {
  id: string;
  project_id?: string;
  category: '공문/인허가' | '안전보건관리비' | '협력사평가' | '장비/점검' | '교육/자격' | '기타';
  title: string;
  details: string;
  assignee: string;
  updated_by: string;
  updated_at: string;
  status: '진행중' | '검토대기' | '완료' | '보류';
  link_url?: string;
  notes?: string;
}
