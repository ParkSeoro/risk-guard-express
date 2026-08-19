import { describe, expect, it } from 'vitest';
import { buildChecklist } from '@/lib/inspectionTemplates';
import {
  PATROL_CHECKLIST_ITEMS,
  PATROL_LOG_CITATIONS,
  PATROL_LOG_DISCLAIMER,
  PATROL_LOG_TITLE,
  buildPatrolLogHtml,
  collectTodayPermitRoute,
  formatInspectorLine,
  inspectorTitleFromMember,
  isPatrolInspection,
  joinPatrolRoute,
} from '@/lib/legalForms/patrolLog';

describe('patrol log form pack', () => {
  it('pins reviewed citations without a live law API', () => {
    expect(PATROL_LOG_TITLE).toBe('작업장 순회점검일지');
    expect(PATROL_LOG_CITATIONS.some((c) => c.id === 'osh-decree-18-1-5')).toBe(true);
    expect(PATROL_LOG_CITATIONS.some((c) => /제15조/.test(c.article))).toBe(false);
    expect(PATROL_CHECKLIST_ITEMS).toHaveLength(4);
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

  it('collects today approved permit locations only', () => {
    const route = collectTodayPermitRoute(
      [
        {
          status: '승인완료',
          permit_date: '2026-08-19',
          location: 'A동 3층',
        },
        {
          status: '작성중',
          permit_date: '2026-08-19',
          location: '초안위치',
        },
        {
          status: '발행완료',
          permit_date: '2026-08-18',
          location: '어제위치',
        },
        {
          status: '발행완료',
          form_data: { work_start: '2026-08-19T08:00', work_location: 'B동 옥상' },
          permit_date: '2026-08-01',
        },
      ],
      '2026-08-19',
    );
    expect(route).toBe('A동 3층 · B동 옥상');
  });

  it('prints patrol log layout with auto-filled header and legal footer', () => {
    const html = buildPatrolLogHtml({
      projectName: '여수 현장',
      siteName: 'H2 공사',
      inspectedAt: '2026-08-19T01:00:00.000Z',
      inspectorName: '김안전',
      inspectorTitle: '안전관리자',
      location: 'A동 3층 · B동 옥상',
      summary: '오전 순회',
      items: [
        {
          checklist_code: 'PT-001',
          label: '현장 전반',
          legal_basis: '시행령 제18조',
          result: 'fail',
          note: '난간 미설치',
          photos: ['https://example.test/p.jpg'],
        },
      ],
      actions: [{ issue: '난간 설치', assignee_name: '이조치', status: 'pending' }],
    });
    expect(html).toContain(PATROL_LOG_TITLE);
    expect(html).toContain('여수 현장');
    expect(html).toContain('김안전 / 안전관리자');
    expect(html).toContain('A동 3층');
    expect(html).toContain('난간 미설치');
    expect(html).toContain('제18조제1항제5호');
    expect(html).toContain('3년간 보존');
    expect(html).not.toContain('산업안전보건법 기반 안전점검표');
  });

  it('does not attach process-specific extras to patrol checklists', () => {
    const items = buildChecklist('patrol', '굴착');
    expect(items.map((i) => i.code)).toEqual(PATROL_CHECKLIST_ITEMS.map((i) => i.code));
    expect(items.some((i) => i.code.startsWith('EXC-'))).toBe(false);
  });
});
