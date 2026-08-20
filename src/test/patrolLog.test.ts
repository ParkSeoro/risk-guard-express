import { describe, expect, it } from 'vitest';
import { buildChecklist } from '@/lib/inspectionTemplates';
import {
  PATROL_CHECKLIST_ITEMS,
  PATROL_LOG_CITATIONS,
  PATROL_LOG_DISCLAIMER,
  PATROL_LOG_PRINT_TITLE,
  PATROL_LOG_TITLE,
  SITE_DIRECTOR_PATROL_TITLE,
  buildPatrolLogHtml,
  collectTodayPermitRoute,
  collectTodayPermitWorks,
  formatInspectorLine,
  formatPatrolDateDot,
  inspectorTitleFromMember,
  isPatrolInspection,
  joinPatrolRoute,
  resultLabelKo,
  weatherLabelFromSnapshots,
} from '@/lib/legalForms/patrolLog';

describe('patrol log form pack', () => {
  it('pins reviewed citations without a live law API', () => {
    expect(PATROL_LOG_TITLE).toBe('순회 안전점검일지');
    expect(PATROL_LOG_PRINT_TITLE).toMatch(/순\s*회/);
    expect(PATROL_LOG_CITATIONS.some((c) => c.id === 'osh-decree-18-1-5')).toBe(true);
    expect(PATROL_LOG_CITATIONS.some((c) => /제15조/.test(c.article))).toBe(false);
    expect(PATROL_CHECKLIST_ITEMS).toHaveLength(13);
    expect(PATROL_CHECKLIST_ITEMS[0].label).toContain('개인보호구');
    expect(PATROL_LOG_DISCLAIMER).toMatch(/대신하거나 보장하지 않습니다/);
  });

  it('joins unique patrol route segments', () => {
    expect(joinPatrolRoute(['3층 굴착', ' 3층 굴착 ', '옥상', ''])).toBe('3층 굴착 · 옥상');
  });

  it('builds inspector line from position then role', () => {
    expect(inspectorTitleFromMember({ position: 'HSE_MANAGER', role: 'worker' })).toBe('안전관리자');
    expect(inspectorTitleFromMember({ position: null, role: 'site_supervisor' })).toBe('관리감독자');
    expect(formatInspectorLine('홍길동', '안전관리자')).toBe('홍길동 / 안전관리자');
  });

  it('collects today approved permit locations and work names', () => {
    const permits = [
      {
        status: '승인완료',
        permit_date: '2026-08-19',
        location: 'A동 3층',
        work_name: '폼그라스 설치작업',
      },
      {
        status: '작성중',
        permit_date: '2026-08-19',
        location: '초안위치',
        work_name: '초안작업',
      },
      {
        status: '발행완료',
        form_data: { work_start: '2026-08-19T08:00', work_location: 'B동 옥상', work_name: 'Pipe Rack 조립' },
        permit_date: '2026-08-01',
      },
    ];
    expect(collectTodayPermitRoute(permits, '2026-08-19')).toBe('A동 3층 · B동 옥상');
    expect(collectTodayPermitWorks(permits, '2026-08-19')).toEqual(['폼그라스 설치작업', 'Pipe Rack 조립']);
  });

  it('reads weather label from permit snapshots', () => {
    expect(weatherLabelFromSnapshots([{ current: { sky: '맑 음' } }])).toBe('맑 음');
  });

  it('prints the LGC excel layout: title, 13-item table, photo sheet, site-director block', () => {
    const html = buildPatrolLogHtml({
      projectName: 'LGC 여수 배관망 증설',
      inspectedAt: '2025-12-01T01:00:00.000Z',
      inspectorName: '김안전',
      inspectorTitle: '안전관리자',
      location: 'A동 3층',
      weather: '맑 음',
      workItems: ['폼그라스 하차및 인양작업', 'Pipe Rack 조립'],
      manpower: [{ group: '당 사', title: '관리', today: 5 }],
      tbmAttendees: 5,
      items: [
        {
          checklist_code: 'PT-01',
          label: '근로자 개인보호구 착용상태',
          result: 'pass',
        },
        {
          checklist_code: 'PT-09',
          label: '고소작업시 난간설치상태',
          result: 'fail',
          note: '난간 미설치',
          photos: ['https://example.test/p.jpg'],
        },
      ],
      actions: [{ issue: '고소작업시 난간설치상태', assignee_name: '이조치', status: 'pending' }],
    });
    expect(html).toContain(PATROL_LOG_PRINT_TITLE);
    expect(html).toContain('현장명 : LGC 여수 배관망 증설');
    expect(html).toContain(formatPatrolDateDot('2025-12-01T01:00:00.000Z') || '2025');
    expect(html).toContain('날씨 : 맑 음');
    expect(html).toContain('작 업 내 용');
    expect(html).toContain('폼그라스 하차및 인양작업');
    expect(html).toContain('점 검 사 항');
    expect(html).toContain('지 적 사 항');
    expect(html).toContain('사진대지');
    expect(html).toContain(SITE_DIRECTOR_PATROL_TITLE);
    expect(html).toContain('관리책임자');
    expect(html).not.toContain('안전보건총괄');
    expect(html).toContain('양호');
    expect(html).toContain('불량');
    expect(html).toContain('난간 미설치');
    expect(html).toContain('김안전 / 안전관리자');
    expect(html).toContain('제18조제1항제5호');
    expect(html).toContain('3년간 보존');
    expect(html).not.toContain('산업안전보건법 기반 안전점검표');
    expect(resultLabelKo('pass')).toBe('양호');
    expect(resultLabelKo('fail')).toBe('불량');
  });

  it('does not attach process-specific extras to patrol checklists', () => {
    const items = buildChecklist('patrol', '굴착');
    expect(items.map((i) => i.code)).toEqual(PATROL_CHECKLIST_ITEMS.map((i) => i.code));
    expect(items.some((i) => i.code.startsWith('EXC-'))).toBe(false);
  });

  it('detects patrol type only', () => {
    expect(isPatrolInspection('patrol')).toBe(true);
    expect(isPatrolInspection('pre_work')).toBe(false);
  });
});
