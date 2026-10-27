import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, AlertTriangle, HardHat, 
  Clock, CheckCircle2, ChevronRight, Activity, 
  MapPin, ClipboardList, PlusCircle, ShieldAlert,
  ClipboardCheck, AlertCircle, Sparkles
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { todayKstDate } from '@/lib/dashboardOps';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PERMIT_APPROVED_STATUSES } from '@/lib/dailyWorkAck';
import { ASSESSMENT_RUN_APPROVED_STATUSES, runAppliesToCompany } from '@/lib/assessmentShareAck';
import { datePartFromDateTime, resolvePermitWorkDate } from '@/lib/permitWorkDate';
import { PERMIT_KIND_LABEL, type PermitKindId } from '@/lib/permitKinds';

interface SiteSafetyRiskControlHubProps {
  projectId?: string;
  onNavigate?: (path: string) => void;
  companyId?: string | null;
  companyType?: string | null;
  seesAllCompanies?: boolean;
}

interface RealPtwItem {
  id: string;
  workName: string;
  permitType: string;
  status: string;
  contractor: string;
  location: string;
  personnelCount: number;
  workTime: string;
  badgeColor: string;
}

interface RealRiskPoint {
  id: string;
  title: string;
  process: string;
  freq: number;
  sev: number;
  score: number;
  quadrant: 1 | 2 | 3 | 4;
  action: string;
  grade: string;
}

interface InspectionSummary {
  totalInspections: number;
  todayInspections: number;
  totalActions: number;
  openActions: number;
  completedActions: number;
  recentActionTitle?: string;
}

export function SiteSafetyRiskControlHub({
  projectId,
  onNavigate,
  companyId,
  companyType,
  seesAllCompanies = true,
}: SiteSafetyRiskControlHubProps) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // 1. PTW 실데이터
  const [activePtws, setActivePtws] = useState<RealPtwItem[]>([]);
  const [totalPtwCount, setTotalPtwCount] = useState(0);
  const [pendingPtwCount, setPendingPtwCount] = useState(0);

  // 2. 위험성평가 4분면 실데이터
  const [riskPoints, setRiskPoints] = useState<RealRiskPoint[]>([]);
  const [totalRiskItemsCount, setTotalRiskItemsCount] = useState(0);

  // 3. 점검 및 지적사항 실데이터
  const [inspectionData, setInspectionData] = useState<InspectionSummary>({
    totalInspections: 0,
    todayInspections: 0,
    totalActions: 0,
    openActions: 0,
    completedActions: 0,
  });

  // 4. 3대 섹터 (TBM, PTW, 점검) 연동 안전 건전성 점수
  const [safetyScore, setSafetyScore] = useState({
    totalScore: 0,
    grade: '데이터 대기',
    gradeColor: 'text-muted-foreground border-border bg-muted/30',
    summary: '현장 실데이터를 연동하여 안전 건전성을 분석하고 있습니다.',
    sectors: [
      { name: '일일 TBM 실시', score: 0, max: 35, rate: '0%', detail: 'TBM 진행 현황 조회 중' },
      { name: '고위험 작업허가(PTW)', score: 0, max: 35, rate: '0%', detail: '작업허가서 승인 현황 조회 중' },
      { name: '안전점검 및 조치', score: 0, max: 30, rate: '0%', detail: '점검 조치율 집계 중' },
    ],
  });

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    async function loadProjectHubData() {
      setLoading(true);
      const today = todayKstDate();
      const isClient = companyType === 'client' || seesAllCompanies;

      try {
        // (1) 협력사 맵핑 로드 (해당 프로젝트 격리)
        const { data: companiesData } = await supabase
          .from('companies')
          .select('id, name')
          .eq('project_id', projectId)
          .eq('is_deleted', false);
        
        const companyMap: Record<string, string> = {};
        (companiesData || []).forEach(c => {
          companyMap[c.id] = c.name;
        });

        // (2) 실제 작업허가서(work_permits) 로드 및 사용자 규칙 필터링
        const { data: permitRows, error: permitErr } = await supabase
          .from('work_permits')
          .select('*')
          .eq('project_id', projectId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false });

        if (permitErr) {
          console.warn('[SiteSafetyRiskControlHub] permit query error:', permitErr);
        }

        const rawPermits = permitRows || [];

        // 규칙 적용:
        // 1. 제외: 삭제, 작업취소, 반려
        // 2. 허용 상태:
        //    - 승인/발행 완료된 허가서만 현장 관제 카드로 표시 (결재중/검토대기는 제외)
        // 3. 날짜: 허가서 내 작업 시작일 기준 (시작일이 오늘이거나, 작업 시작~종료일 사이에 오늘이 포함된 작업)
        let inApprovalCount = 0;
        const validPermits = rawPermits.filter(p => {
          if (p.is_deleted || p.status === '작업취소' || (p as any).voided_at || p.status === '반려') return false;

          const s = String(p.status || '').trim();
          const isApproved = PERMIT_APPROVED_STATUSES.has(s);
          const isPending = ['결재중', '결재진행', '검토대기', '검토완료', '대기', '종료대기'].includes(s);

          if (isPending) {
            inApprovalCount++;
          }

          if (!isApproved) return false;

          // 해당일(작업 시작일) 기준 유효 판정
          const startDate = resolvePermitWorkDate(p) || datePartFromDateTime(p.work_start_at) || datePartFromDateTime((p as any).permit_date);
          const endDate = datePartFromDateTime(p.work_end_at) || (p.form_data && (p.form_data as any).work_end ? datePartFromDateTime((p.form_data as any).work_end) : null) || startDate;

          let isMatchDate = false;
          if (startDate && endDate) {
            isMatchDate = today >= startDate && today <= endDate;
          } else if (startDate) {
            isMatchDate = startDate === today;
          }

          if (!isMatchDate) return false;

          if (!isClient && companyId) {
            const matchesId = p.company_id === companyId;
            const matchesName = companyMap[companyId] && p.contractor_company === companyMap[companyId];
            if (!matchesId && !matchesName) return false;
          }

          return true;
        });

        const totalPermits = validPermits.length;
        setPendingPtwCount(inApprovalCount);

        const formattedPtws: RealPtwItem[] = validPermits.slice(0, 6).map(p => {
          const rawKind = (p.permit_kinds && p.permit_kinds.length > 0)
            ? p.permit_kinds[0]
            : (p.permit_type || 'general');

          const typeLabel = PERMIT_KIND_LABEL[rawKind as PermitKindId] || (
            rawKind === 'general' ? '일반' :
            rawKind === 'hot_work' ? '화기' :
            rawKind === 'confined_space' ? '밀폐공간' :
            rawKind === 'excavation' ? '굴착·중장비' : rawKind
          );

          let badgeColor = 'bg-primary/10 text-primary border-primary/30';
          if (typeLabel.includes('화기') || rawKind === 'hot_work') badgeColor = 'bg-rose-500/10 text-rose-500 border-rose-500/30';
          else if (typeLabel.includes('양중') || typeLabel.includes('크레인')) badgeColor = 'bg-amber-500/10 text-amber-500 border-amber-500/30';
          else if (typeLabel.includes('고소') || typeLabel.includes('비계')) badgeColor = 'bg-indigo-500/10 text-indigo-500 border-indigo-500/30';
          else if (typeLabel.includes('밀폐') || rawKind === 'confined_space') badgeColor = 'bg-purple-500/10 text-purple-500 border-purple-500/30';
          else if (typeLabel.includes('굴착') || rawKind === 'excavation') badgeColor = 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';

          const contractorName = p.company_id && companyMap[p.company_id]
            ? companyMap[p.company_id]
            : (p.contractor_company || '시공사 직영');

          let timeStr = '금일 작업';
          if (p.work_start_at && p.work_end_at) {
            const start = new Date(p.work_start_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            const end = new Date(p.work_end_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
            timeStr = `${start} ~ ${end}`;
          } else if ((p as any).permit_date) {
            timeStr = (p as any).permit_date;
          }

          const workTitle = p.work_name || (p as any).work_description || ((p as any).form_data && (p as any).form_data.work_title) || '작업허가 항목';

          return {
            id: p.id,
            workName: workTitle,
            permitType: typeLabel,
            status: p.status || '대기',
            contractor: contractorName,
            location: p.location || '현장 지정 구역',
            personnelCount: p.personnel_count || 1,
            workTime: timeStr,
            badgeColor,
          };
        });

        // (3) 실제 위험성평가 회차 및 위험항목(risk_items) 로드
        // 규칙 적용: 해당일(today)이 포함된 위험성평가 회차를 선별하여 프로젝트 통합 집계
        const { data: runs, error: runsErr } = await supabase
          .from('assessment_runs')
          .select('id, status, target_company_ids, author_company_id, start_date, end_date, created_at')
          .eq('project_id', projectId)
          .eq('is_deleted', false)
          .neq('status', '폐기')
          .order('created_at', { ascending: false });

        if (runsErr) {
          console.warn('[SiteSafetyRiskControlHub] assessment_runs query error:', runsErr);
        }

        const allRuns = (runs || []).filter(r => {
          if (!ASSESSMENT_RUN_APPROVED_STATUSES.has(String(r.status || '').trim())) return false;
          if (!isClient && companyId) {
            return runAppliesToCompany(r, companyId);
          }
          return true;
        });

        // 1) 오늘 일자가 시작~종료일 사이에 포함된 회차 선별
        let validRuns = allRuns.filter(r => {
          const start = datePartFromDateTime(r.start_date);
          const end = datePartFromDateTime(r.end_date);
          if (start && end) {
            return today >= start && today <= end;
          }
          if (start) {
            return today >= start;
          }
          if (end) {
            return today <= end;
          }
          return false;
        });

        // 2) 만약 오늘 날짜로 지정된 회차가 아직 등록되어 있지 않다면,
        // 현장의 최신 승인 회차(가장 최근 완료된 상시/정기 평가)를 fallback으로 사용하여 관제 매트릭스가 비지 않도록 지원
        if (validRuns.length === 0 && allRuns.length > 0) {
          validRuns = [allRuns[0]];
        }

        // 3) 만약 승인된 회차가 아직 없더라도, 프로젝트에 등록된 최신 회차를 fallback으로 사용하여 위험요소 매트릭스 시각화
        if (validRuns.length === 0 && (runs || []).length > 0) {
          validRuns = [(runs as any[])[0]];
        }

        const runIds = validRuns.map(r => r.id);
        let realPoints: RealRiskPoint[] = [];

        if (runIds.length > 0) {
          const { data: rawItems, error: itemsErr } = await supabase
            .from('risk_items')
            .select('*')
            .in('run_id', runIds)
            .eq('is_deleted', false)
            .limit(150);

          if (itemsErr) {
            console.warn('[SiteSafetyRiskControlHub] risk_items query error:', itemsErr);
          }

          realPoints = (rawItems || []).map((item: any) => {
            const f = item.improved_frequency || item.frequency || 2;
            const s = item.improved_severity || item.severity || 2;
            const score = item.improved_risk || item.risk || (f * s);
            
            // 4분면 분할 로직 (기준점 3.0)
            let quadrant: 1 | 2 | 3 | 4 = 3;
            if (s >= 3 && f >= 3) {
              quadrant = 1; // 고빈도 · 고강도 (집중 통제)
            } else if (s >= 3 && f < 3) {
              quadrant = 2; // 저빈도 · 고강도 (중대 잠재)
            } else if (s < 3 && f >= 3) {
              quadrant = 4; // 고빈도 · 저강도 (빈발 주의)
            } else {
              quadrant = 3; // 저빈도 · 저강도 (통상 관리)
            }

            const title = item.hazard || item.hazard_situation || item.sub_task || item.process || '위험요인 미기재';
            const action = item.improvement_measure || item.existing_measure || '산안법 기준 안전수칙 준수 및 보호구 착용 철저';

            return {
              id: item.id,
              title,
              process: item.process || '공통공종',
              freq: f,
              sev: s,
              score,
              quadrant,
              action,
              grade: item.improved_risk_grade || item.risk_grade || (score >= 12 ? '상' : score >= 6 ? '중' : '하'),
            };
          });
        }

        // 4) 만약 회차 연결이 없더라도 해당 프로젝트에 등록된 위험항목이 직접 존재하는 경우 통합 집계
        if (realPoints.length === 0) {
          const { data: directItems, error: directErr } = await supabase
            .from('risk_items')
            .select('*')
            .eq('project_id', projectId)
            .eq('is_deleted', false)
            .limit(150);

          if (directErr) {
            console.warn('[SiteSafetyRiskControlHub] direct risk_items query error:', directErr);
          }

          if (directItems && directItems.length > 0) {
            realPoints = directItems.map((item: any) => {
              const f = item.improved_frequency || item.frequency || 2;
              const s = item.improved_severity || item.severity || 2;
              const score = item.improved_risk || item.risk || (f * s);
              
              let quadrant: 1 | 2 | 3 | 4 = 3;
              if (s >= 3 && f >= 3) quadrant = 1;
              else if (s >= 3 && f < 3) quadrant = 2;
              else if (s < 3 && f >= 3) quadrant = 4;
              else quadrant = 3;

              const title = item.hazard || item.hazard_situation || item.sub_task || item.process || '위험요인 미기재';
              const action = item.improvement_measure || item.existing_measure || '산안법 기준 안전수칙 준수 및 보호구 착용 철저';

              return {
                id: item.id,
                title,
                process: item.process || '공통공종',
                freq: f,
                sev: s,
                score,
                quadrant,
                action,
                grade: item.improved_risk_grade || item.risk_grade || (score >= 12 ? '상' : score >= 6 ? '중' : '하'),
              };
            });
          }
        }

        // (4) 실제 TBM 세션 로드 (금일 및 누적)
        const { data: tbmToday, count: tbmTotalCount } = await supabase
          .from('tbm_sessions' as any)
          .select('id, status, attendee_count, tbm_date, leader_name, work_name', { count: 'exact' })
          .eq('project_id', projectId)
          .eq('tbm_date', today)
          .eq('is_deleted', false);

        const todayTbms = (tbmToday || []) as any[];
        const totalTbmCount = tbmTotalCount || 0;

        // (5) 실제 안전점검 및 조치 결과 로드 (safety_inspections & safety_inspection_actions)
        const { data: insps, count: inspCount } = await supabase
          .from('safety_inspections' as any)
          .select('id, inspected_at, status, summary', { count: 'exact' })
          .eq('project_id', projectId)
          .eq('is_deleted', false);

        const { data: acts, count: actCount } = await supabase
          .from('safety_inspection_actions' as any)
          .select('id, status, hazard_factor, corrective_action, created_at', { count: 'exact' })
          .eq('project_id', projectId);

        const allInspections = (insps || []) as any[];
        const allActions = (acts || []) as any[];
        const totalInspections = inspCount || allInspections.length;
        const totalActions = actCount || allActions.length;
        
        const openActionsList = allActions.filter(a => 
          a.status === 'open' || a.status === 'in_progress' || a.status === 'action_pending' || a.status === '미조치' || a.status === '조치중'
        );
        const openActionsCount = openActionsList.length;
        const completedActionsCount = totalActions - openActionsCount;
        const todayInspectionsCount = allInspections.filter(i => (i.inspected_at || '').startsWith(today)).length;

        // (6) 각 섹터별(TBM, PTW, 점검) 정밀 연동 안전 점수 산출 (총 100점 만점)
        
        // [섹터 1] 일일 TBM 실시 현황 (35점 만점)
        let tbmScore = 0;
        let tbmRate = '0%';
        let tbmDetail = '금일 TBM 미실시';
        if (todayTbms.length > 0) {
          const completedTbms = todayTbms.filter(t => t.status === '완료').length;
          const totalAttendees = todayTbms.reduce((acc, cur) => acc + (cur.attendee_count || 0), 0);
          tbmScore = completedTbms === todayTbms.length ? 35 : Math.round(25 + (completedTbms / todayTbms.length) * 10);
          tbmRate = `${Math.round((completedTbms / todayTbms.length) * 100)}%`;
          tbmDetail = `금일 ${todayTbms.length}개 세션 (${totalAttendees}명 참석, 완료 ${completedTbms})`;
        } else if (totalTbmCount > 0) {
          tbmScore = 15;
          tbmRate = '0%';
          tbmDetail = `금일 미실시 (누적 ${totalTbmCount}건 실시 이력)`;
        } else {
          tbmScore = 0;
          tbmRate = '미등록';
          tbmDetail = '현장 TBM 등록 이력 없음';
        }

        // [섹터 2] 고위험 작업허가(PTW) 승인 및 통제 현황 (35점 만점)
        let ptwScore = 35;
        let ptwRate = '100%';
        let ptwDetail = '진행 중인 고위험 작업 없음';
        const approvedPermits = rawPermits.filter(p => 
          p.status === '승인' || p.status === '승인완료' || p.status === '발행완료' || p.status === '작업중' || p.status === 'approved' || p.status === 'ISSUED'
        ).length;
        const inApprovalPermits = rawPermits.filter(p => 
          p.status === '결재중' || p.status === '결재진행' || p.status === '검토대기'
        ).length;
        const draftOrRejectedPermits = rawPermits.filter(p => 
          p.status === '작성중' || p.status === '임시저장' || p.status === '반려'
        ).length;

        if (rawPermits.length > 0) {
          const approvalRatio = (approvedPermits + inApprovalPermits * 0.7) / rawPermits.length;
          ptwScore = Math.round(Math.min(35, Math.max(10, approvalRatio * 35)));
          ptwRate = `${Math.round((approvedPermits / rawPermits.length) * 100)}%`;
          ptwDetail = `승인 ${approvedPermits}건 / 결재중 ${inApprovalPermits}건 (총 ${rawPermits.length}건)`;
        } else {
          ptwScore = 35; // 허가 없이 무단 진행하는 작업이 없으므로 안전상 기본 준수
          ptwRate = '정상 대기';
          ptwDetail = '현재 등록된 고위험 작업허가 없음 (0건)';
        }

        // [섹터 3] 안전점검 및 지적사항 조치 현황 (30점 만점)
        let inspectionScore = 30;
        let inspectionRate = '100%';
        let inspectionDetail = '지적사항 없는 클린 현장';

        if (totalActions > 0) {
          const actionCompletionRatio = completedActionsCount / totalActions;
          inspectionScore = Math.round(Math.max(5, actionCompletionRatio * 30));
          inspectionRate = `${Math.round(actionCompletionRatio * 100)}%`;
          inspectionDetail = `조치완료 ${completedActionsCount}건 / 미조치 ${openActionsCount}건 (총 ${totalActions}건)`;
        } else if (totalInspections > 0) {
          inspectionScore = 30;
          inspectionRate = '100%';
          inspectionDetail = `지적사항 0건 (누적 점검 ${totalInspections}회)`;
        } else {
          inspectionScore = 20; // 아직 점검 데이터 없음
          inspectionRate = '미실시';
          inspectionDetail = '안전점검 등록 이력 없음';
        }

        // (7) 종합 점수 및 현장 안전 등급 판정
        const totalScore = Math.min(100, Math.max(0, tbmScore + ptwScore + inspectionScore));
        let grade = 'S (최우수)';
        let gradeColor = 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
        
        if (totalScore >= 90) {
          grade = 'S (최우수)';
          gradeColor = 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
        } else if (totalScore >= 80) {
          grade = 'A (우수)';
          gradeColor = 'text-green-500 border-green-500/30 bg-green-500/10';
        } else if (totalScore >= 70) {
          grade = 'B (보통)';
          gradeColor = 'text-blue-500 border-blue-500/30 bg-blue-500/10';
        } else if (totalScore >= 60) {
          grade = 'C (주의)';
          gradeColor = 'text-amber-500 border-amber-500/30 bg-amber-500/10';
        } else {
          grade = 'D (경고)';
          gradeColor = 'text-rose-500 border-rose-500/30 bg-rose-500/10';
        }

        // 현장 실제 상황에 맞춘 동적 요약 브리핑 생성
        let summary = '';
        if (todayTbms.length === 0 && rawPermits.length === 0 && totalInspections === 0 && realPoints.length === 0) {
          summary = '현장 운영 데이터(TBM, PTW, 안전점검, 위험성평가) 수집 대기 중입니다. 현장 작업을 등록하면 실시간 안전 건전성이 자동 산출됩니다.';
        } else if (openActionsCount > 0) {
          summary = `안전점검 미조치 지적사항이 ${openActionsCount}건 남아있어 즉각적인 시정 조치가 필요합니다. (조치율: ${inspectionRate})`;
        } else if (todayTbms.length === 0) {
          summary = `금일 일일 TBM 일지가 등록되지 않았습니다. 작업 투입 전 TBM 안전교육을 실시하고 등록해주세요.`;
        } else if (draftOrRejectedPermits > 0) {
          summary = `작업허가서 중 미승인/결재 대기 항목이 ${draftOrRejectedPermits}건 있습니다. 무단 작업을 방지하기 위해 승인을 완료하세요.`;
        } else {
          summary = `금일 TBM ${todayTbms.length}건 완료, 고위험 작업허가 ${approvedPermits}건 승인, 점검 조치율 ${inspectionRate}로 안전 기준이 양호하게 준수되고 있습니다.`;
        }

        if (isMounted) {
          setActivePtws(formattedPtws);
          setTotalPtwCount(totalPermits);
          setRiskPoints(realPoints);
          setTotalRiskItemsCount(realPoints.length);
          setInspectionData({
            totalInspections,
            todayInspections: todayInspectionsCount,
            totalActions,
            openActions: openActionsCount,
            completedActions: completedActionsCount,
            recentActionTitle: openActionsList[0]?.hazard_factor || undefined,
          });
          setSafetyScore({
            totalScore,
            grade,
            gradeColor,
            summary,
            sectors: [
              { name: '일일 TBM 실시', score: tbmScore, max: 35, rate: tbmRate, detail: tbmDetail },
              { name: '고위험 작업허가(PTW)', score: ptwScore, max: 35, rate: ptwRate, detail: ptwDetail },
              { name: '안전점검 및 조치', score: inspectionScore, max: 30, rate: inspectionRate, detail: inspectionDetail },
            ],
          });
        }
      } catch (err) {
        console.error('Failed to load project hub real data:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadProjectHubData();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const q1Items = riskPoints.filter(p => p.quadrant === 1);
  const q2Items = riskPoints.filter(p => p.quadrant === 2);
  const q3Items = riskPoints.filter(p => p.quadrant === 3);
  const q4Items = riskPoints.filter(p => p.quadrant === 4);

  const filteredPoints = selectedQuadrant 
    ? riskPoints.filter(p => p.quadrant === selectedQuadrant)
    : riskPoints;

  return (
    <div className="space-y-4">
      
      {/* 1. 최상단: 종합 현장 안전 등급 바 & 진행 중 고위험 작업 현황 헤더 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        
        {/* 좌측: 현장 종합 안전 등급 스코어 카드 (4 cols) */}
        <div className="lg:col-span-4 rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-primary" />
                현장 종합 안전 건전성 지수
              </span>
              <span className={`text-[11px] font-extrabold px-2.5 py-0.5 rounded-full border ${safetyScore.gradeColor}`}>
                {safetyScore.grade}
              </span>
            </div>

            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-4xl font-black tracking-tight text-foreground tabular-nums">
                {safetyScore.totalScore}
              </span>
              <span className="text-xs text-muted-foreground font-semibold">/ 100점 (현장 실데이터 산정)</span>
            </div>

            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              {safetyScore.summary}
            </p>
          </div>

          {/* 3대 핵심 섹터(TBM, PTW, 점검) 점수 바 */}
          <div className="mt-4 pt-3 border-t space-y-2.5">
            <div className="text-[11px] font-bold text-muted-foreground flex items-center justify-between">
              <span>3대 섹터별 연동 점수</span>
              <span className="text-[10px] text-primary font-normal">TBM · PTW · 점검</span>
            </div>

            {safetyScore.sectors.map((sec, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground flex items-center gap-1">
                    {idx === 0 && <Clock className="h-3 w-3 text-muted-foreground" />}
                    {idx === 1 && <HardHat className="h-3 w-3 text-muted-foreground" />}
                    {idx === 2 && <ClipboardCheck className="h-3 w-3 text-muted-foreground" />}
                    {sec.name}
                  </span>
                  <span className="text-muted-foreground font-mono">
                    <strong className="text-foreground">{sec.score}</strong>/{sec.max}점 ({sec.rate})
                  </span>
                </div>
                <div className="w-full bg-muted h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-primary h-full rounded-full transition-all duration-500" 
                    style={{ width: `${Math.min(100, Math.max(0, (sec.score / sec.max) * 100))}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground truncate">{sec.detail}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 우측: 현재 현장 작업허가(PTW) 실데이터 시각화 (8 cols) */}
        <div className="lg:col-span-8 rounded-xl border bg-card p-4 shadow-sm flex flex-col justify-between">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`h-2.5 w-2.5 rounded-full ${activePtws.length > 0 ? 'bg-rose-500 animate-ping' : 'bg-slate-400'}`} />
              <h3 className="text-sm font-bold text-foreground">
                현장 고위험 작업허가(PTW) 현황
              </h3>
              <Badge variant="outline" className="text-[11px] font-semibold text-primary border-primary/30 bg-primary/5">
                오늘 승인 {totalPtwCount}건
              </Badge>
              {pendingPtwCount > 0 && (
                <Badge variant="outline" className="text-[11px] font-semibold text-amber-600 border-amber-500/30 bg-amber-500/10">
                  결재 대기 {pendingPtwCount}건
                </Badge>
              )}
            </div>
            <button
              onClick={() => onNavigate?.('/work-permits')}
              className="text-xs text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
            >
              작업허가서 전체 보기 <ChevronRight className="h-3 w-3" />
            </button>
          </div>

          {activePtws.length === 0 ? (
            <div className="py-8 text-center rounded-lg border border-dashed bg-muted/20 flex flex-col items-center justify-center space-y-2 my-auto">
              <ClipboardList className="h-8 w-8 text-muted-foreground/60" />
              <p className="text-xs font-semibold text-muted-foreground">
                현재 현장에 등록된 작업허가서(PTW)가 없습니다.
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                화기, 양중, 고소 등 위험작업 시작 전 안전작업허가서를 등록하고 승인 받으세요.
              </p>
              <button
                onClick={() => onNavigate?.('/work-permits')}
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline cursor-pointer"
              >
                <PlusCircle className="h-3.5 w-3.5" /> 작업허가서 신청하기
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {activePtws.map((ptw) => (
                <div 
                  key={ptw.id} 
                  onClick={() => onNavigate?.(`/work-permits/${ptw.id}`)}
                  className="rounded-lg border bg-muted/40 p-3 flex flex-col justify-between hover:border-primary/50 transition-colors cursor-pointer"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${ptw.badgeColor}`}>
                        {ptw.permitType}
                      </span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        ptw.status === '승인완료' || ptw.status === '승인' || ptw.status === '발행완료' || ptw.status === '작업중'
                          ? 'text-emerald-600 bg-emerald-500/10' :
                        ptw.status === '반려' 
                          ? 'text-destructive bg-destructive/10' :
                        'text-amber-600 bg-amber-500/10'
                      }`}>
                        {ptw.status}
                      </span>
                    </div>

                    <h4 className="text-xs font-bold text-foreground mt-2 line-clamp-1" title={ptw.workName}>
                      {ptw.workName}
                    </h4>

                    <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ptw.location}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <HardHat className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ptw.contractor} ({ptw.personnelCount}명)</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 pt-2 border-t border-border/60 text-[10px] text-muted-foreground flex items-center justify-between">
                    <span className="font-semibold text-foreground">허가 연동</span>
                    <span className="flex items-center gap-0.5 text-muted-foreground font-mono">
                      <Clock className="h-3 w-3" /> {ptw.workTime}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 안전 통제 확인 하단 바: 점검 및 TBM 동시 요약 */}
          <div className="mt-3 pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              현장 DB 실데이터: 허가 {totalPtwCount}건, 점검 {inspectionData.totalInspections}건, 미조치 지적사항 {inspectionData.openActions}건
            </span>
            <span className="text-[11px] text-muted-foreground">실시간 동기화</span>
          </div>
        </div>

      </div>

      {/* 2. 중단: 실제 위험성평가 수준 4분면 매트릭스 그래프 (4-Quadrant Risk Matrix) */}
      <div className="rounded-xl border bg-card p-4 shadow-sm space-y-4">
        
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-bold text-foreground">
                현장 실제 위험성평가(JSA) 4분면 매트릭스 관제
              </h3>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              공종별 발생 가능성(빈도, X축)과 피해 중대성(강도, Y축)을 4분면으로 실시간 집계하여 집중 통제 구역을 표시합니다.
            </p>
          </div>

          {/* 분면 필터 탭 */}
          <div className="flex items-center gap-1 text-[11px] flex-wrap">
            <button
              onClick={() => setSelectedQuadrant(null)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                selectedQuadrant === null ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              전체 ({riskPoints.length}건)
            </button>
            <button
              onClick={() => setSelectedQuadrant(1)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                selectedQuadrant === 1 ? 'bg-rose-600 text-white' : 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20'
              }`}
            >
              1분면 집중통제 ({q1Items.length})
            </button>
            <button
              onClick={() => setSelectedQuadrant(2)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                selectedQuadrant === 2 ? 'bg-orange-600 text-white' : 'bg-orange-500/10 text-orange-600 hover:bg-orange-500/20'
              }`}
            >
              2분면 중대잠재 ({q2Items.length})
            </button>
            <button
              onClick={() => setSelectedQuadrant(3)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                selectedQuadrant === 3 ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20'
              }`}
            >
              3분면 통상관리 ({q3Items.length})
            </button>
            <button
              onClick={() => setSelectedQuadrant(4)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                selectedQuadrant === 4 ? 'bg-amber-600 text-white' : 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20'
              }`}
            >
              4분면 빈발주의 ({q4Items.length})
            </button>
          </div>
        </div>

        {riskPoints.length === 0 ? (
          <div className="py-12 text-center rounded-lg border border-dashed bg-muted/20 flex flex-col items-center justify-center space-y-2">
            <ShieldAlert className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-xs font-semibold text-muted-foreground">
              현재 프로젝트에 등록된 위험성평가 항목이 없습니다.
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              위험성평가 메뉴에서 정기/수시 평가 회차를 생성하고 위험요인을 도출하면 4분면 매트릭스가 실데이터로 자동 시각화됩니다.
            </p>
            <button
              onClick={() => onNavigate?.('/risk-assessment')}
              className="mt-2 inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline cursor-pointer"
            >
              위험성평가 관리 바로가기 ➔
            </button>
          </div>
        ) : (
          /* 4분면 그래프 시각화 및 세부 리스트 2단 그리드 */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
            
            {/* 좌측: 정밀 4분면 인터랙티브 차트 (7 cols) */}
            <div className="lg:col-span-7 bg-muted/30 p-4 rounded-xl border relative">
              
              {/* Y축 라벨 (강도 / Severity) */}
              <div className="text-[11px] font-bold text-muted-foreground mb-1 flex items-center justify-between">
                <span>▲ 강도(Severity: 피해 중대성 1~5)</span>
                <span className="text-[10px] text-muted-foreground font-normal">분면을 클릭하면 해당 항목만 필터링됩니다</span>
              </div>

              {/* 4분면 그리드 컨테이너 */}
              <div className="aspect-[16/10] sm:aspect-[16/9] w-full grid grid-cols-2 grid-rows-2 gap-2 relative p-2 bg-background rounded-lg border">
                
                {/* 제2분면 (좌상단): 저빈도 · 고강도 (중대사고 잠재 구역) */}
                <div 
                  onClick={() => setSelectedQuadrant(2)}
                  className={`p-3 rounded-lg border flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden ${
                    selectedQuadrant === 2 
                      ? 'bg-orange-500/20 border-orange-500 ring-2 ring-orange-500/30' 
                      : 'bg-orange-500/5 border-orange-500/20 hover:bg-orange-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-orange-600">제2분면: 중대재해 잠재</span>
                    <span className="text-[10px] bg-orange-500/20 text-orange-700 px-1.5 py-0.5 rounded font-bold">
                      {q2Items.length}건
                    </span>
                  </div>
                  <div className="space-y-1 my-2">
                    {q2Items.slice(0, 2).map((it) => (
                      <div key={it.id} className="text-[11px] font-semibold text-foreground flex items-center gap-1 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500 shrink-0" />
                        <span className="truncate">{it.title}</span>
                      </div>
                    ))}
                    {q2Items.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">해당 분면 항목 없음</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">기준: 빈도(1~2.9) × 강도(3~5)</span>
                </div>

                {/* 제1분면 (우상단): 고빈도 · 고강도 (집중 통제 구역 - 최위험) */}
                <div 
                  onClick={() => setSelectedQuadrant(1)}
                  className={`p-3 rounded-lg border flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden ${
                    selectedQuadrant === 1 
                      ? 'bg-rose-500/20 border-rose-500 ring-2 ring-rose-500/30' 
                      : 'bg-rose-500/5 border-rose-500/20 hover:bg-rose-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-rose-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> 제1분면: 집중 통제 구역
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      q1Items.length > 0 ? 'bg-rose-500/20 text-rose-700 animate-pulse' : 'bg-muted text-muted-foreground'
                    }`}>
                      {q1Items.length}건 {q1Items.length > 0 ? '(집중)' : ''}
                    </span>
                  </div>
                  <div className="space-y-1 my-2">
                    {q1Items.slice(0, 2).map((it) => (
                      <div key={it.id} className="text-[11px] font-semibold text-foreground flex items-center gap-1 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                        <span className="truncate">{it.title}</span>
                      </div>
                    ))}
                    {q1Items.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">고위험 집중 항목 없음</span>
                    )}
                  </div>
                  <span className="text-[10px] text-rose-600 font-semibold">기준: 빈도(3~5) × 강도(3~5)</span>
                </div>

                {/* 제3분면 (좌하단): 저빈도 · 저강도 (통상 관리 구역) */}
                <div 
                  onClick={() => setSelectedQuadrant(3)}
                  className={`p-3 rounded-lg border flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden ${
                    selectedQuadrant === 3 
                      ? 'bg-emerald-500/20 border-emerald-500 ring-2 ring-emerald-500/30' 
                      : 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-emerald-600">제3분면: 통상 관리</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-700 px-1.5 py-0.5 rounded font-bold">
                      {q3Items.length}건
                    </span>
                  </div>
                  <div className="space-y-1 my-2">
                    {q3Items.slice(0, 2).map((it) => (
                      <div key={it.id} className="text-[11px] font-semibold text-foreground flex items-center gap-1 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        <span className="truncate">{it.title}</span>
                      </div>
                    ))}
                    {q3Items.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">해당 분면 항목 없음</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">기준: 빈도(1~2.9) × 강도(1~2.9)</span>
                </div>

                {/* 제4분면 (우하단): 고빈도 · 저강도 (빈발 주의 구역) */}
                <div 
                  onClick={() => setSelectedQuadrant(4)}
                  className={`p-3 rounded-lg border flex flex-col justify-between transition-all cursor-pointer relative overflow-hidden ${
                    selectedQuadrant === 4 
                      ? 'bg-amber-500/20 border-amber-500 ring-2 ring-amber-500/30' 
                      : 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-600">제4분면: 빈발 경미재해</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-700 px-1.5 py-0.5 rounded font-bold">
                      {q4Items.length}건
                    </span>
                  </div>
                  <div className="space-y-1 my-2">
                    {q4Items.slice(0, 2).map((it) => (
                      <div key={it.id} className="text-[11px] font-semibold text-foreground flex items-center gap-1 truncate">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                        <span className="truncate">{it.title}</span>
                      </div>
                    ))}
                    {q4Items.length === 0 && (
                      <span className="text-[10px] text-muted-foreground italic">해당 분면 항목 없음</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground">기준: 빈도(3~5) × 강도(1~2.9)</span>
                </div>

              </div>

              {/* X축 라벨 (빈도 / Frequency) */}
              <div className="text-[11px] font-bold text-muted-foreground mt-2 text-right">
                빈도(Frequency: 발생 가능성 1~5) ▶
              </div>
            </div>

            {/* 우측: 선택된 분면의 실제 위험요인 및 개선대책 리스트 (5 cols) */}
            <div className="lg:col-span-5 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-foreground">
                <span>
                  {selectedQuadrant ? `${selectedQuadrant}분면 위험요인` : '현장 위험요인'} ({filteredPoints.length}건)
                </span>
                <button 
                  onClick={() => onNavigate?.('/risk-assessment')}
                  className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                >
                  위험성평가표 전체 ➔
                </button>
              </div>

              <div className="space-y-2 max-h-[290px] overflow-y-auto pr-1">
                {filteredPoints.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">선택된 분면에 해당하는 위험 항목이 없습니다.</p>
                ) : (
                  filteredPoints.slice(0, 15).map((item) => (
                    <div 
                      key={item.id} 
                      className="rounded-lg border bg-muted/40 p-2.5 text-xs space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-foreground line-clamp-1" title={item.title}>
                          [{item.process}] {item.title}
                        </span>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          item.quadrant === 1 ? 'bg-rose-500/20 text-rose-600' :
                          item.quadrant === 2 ? 'bg-orange-500/20 text-orange-600' :
                          item.quadrant === 3 ? 'bg-emerald-500/20 text-emerald-600' : 'bg-amber-500/20 text-amber-600'
                        }`}>
                          {item.freq} × {item.sev} = {item.score}점
                        </span>
                      </div>

                      <div className="text-[11px] text-muted-foreground bg-background p-1.5 rounded border border-border/60">
                        <strong className="text-foreground">안전 대책: </strong>
                        {item.action}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

      </div>

    </div>
  );
}
