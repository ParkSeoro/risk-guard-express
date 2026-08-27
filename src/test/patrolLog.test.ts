import { describe, expect, it } from 'vitest';
import { buildChecklist } from '@/lib/inspectionTemplates';
import {
  PATROL_CHECKLIST_ITEMS,
  PATROL_FINDING_PHOTO_SHEET_TITLE,
  PATROL_LOG_CITATIONS,
  PATROL_LOG_DISCLAIMER,
  PATROL_LOG_PRINT_TITLE,
  PATROL_LOG_TITLE,
  PATROL_WALK_PHOTO_LABEL,
  SITE_DIRECTOR_PATROL_TITLE,
  buildPatrolLogHtml,
  collectFindingPhotoSheets,
  collectTodayPermitRoute,
  collectTodayPermitWorks,
  formatInspectorLine,
  formatPatrolDateDot,
  formatSiteLabel,
  inspectorTitleFromMember,
  isPatrolInspection,
  joinPatrolRoute,
  pickPatrolPrintStamps,
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
    expect(inspectorTitleFromMember({ position: null, role: 'master' })).toBe('');
    expect(inspectorTitleFromMember({ position: null, role: 'project_admin' })).toBe('');
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
    expect(collectTodayPermitWorks([{
      status: '승인완료',
      permit_date: '2026-08-19',
      form_data: { work_description: '배관 용접 및 비파괴검사' },
    }], '2026-08-19')).toEqual(['배관 용접 및 비파괴검사']);
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
    expect(html).toContain('Pipe Rack 조립');
    expect(html).toContain('colspan="5"');
    expect(html).not.toContain('rowspan="1">- 폼그라스');
    expect(html).toContain('점 검 사 항');
    expect(html).toContain('지 적 사 항');
    expect(html).toContain(PATROL_WALK_PHOTO_LABEL);
    expect(html).toContain(`${PATROL_WALK_PHOTO_LABEL} 1`);
    expect(html).toContain('class="patrol-photos"');
    expect(html).not.toContain('순회 모습');
    expect(html).not.toContain('사진대지');
    expect(html).not.toContain('안전보건총괄');
    expect(html).not.toContain('총괄책임자');
    expect(html).toContain('안전보건관리책임자');
    expect(html).toContain(SITE_DIRECTOR_PATROL_TITLE);
    expect(html).toContain('양호');
    expect(html).toContain('불량');
    expect(html).toContain('난간 미설치');
    expect(html).toContain('미지정');
    expect(html).not.toContain('김안전 / 안전관리자');
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

  it('dedupes identical project and site names', () => {
    expect(formatSiteLabel('GSC 여수 H2/LCO2 PJT', 'GSC 여수 H2/LCO2 PJT')).toBe('GSC 여수 H2/LCO2 PJT');
    expect(formatSiteLabel('현장A', '여수')).toBe('현장A / 여수');
  });

  it('puts fail reason and photos in the finding cell, director improve when mid/fail', () => {
    const html = buildPatrolLogHtml({
      projectName: 'GSC 여수 H2/LCO2 PJT',
      siteName: 'GSC 여수 H2/LCO2 PJT',
      inspectedAt: '2026-08-24T00:00:00.000Z',
      inspectorName: '김재현',
      inspectorTitle: '안전관리자',
      location: 'GSC현장',
      weather: '맑음',
      items: [{
        checklist_code: 'PT-01',
        label: '근로자 개인보호구 착용상태',
        result: 'fail',
        note: '안전모 미착용',
        photos: ['https://example.test/before.jpg'],
      }],
      actions: [{
        issue: '근로자 개인보호구 착용상태',
        status: 'done',
        completion_note: '재교육 완료',
        evidence_photos: ['https://example.test/after.jpg'],
      }],
      patrolPhotos: ['https://example.test/walk1.jpg', 'https://example.test/walk2.jpg'],
      directorItems: [
        { code: 'SD-01', category: '이동통행로', label: '가설이동통로 설치상태', result: 'mid', improve: '통로 정리 필요' },
        { code: 'SD-02', category: '개인보호구', label: '근로자 개인보호구 착용 상태', result: 'pass', improve: '' },
        { code: 'SD-03', category: '현장정리정돈', label: '작업구간 정리정돈상태', result: 'fail', improve: '잔재 반출' },
      ],
    });
    expect(html).toContain('현장명 : GSC 여수 H2/LCO2 PJT');
    expect(html).not.toContain('GSC 여수 H2/LCO2 PJT / GSC 여수 H2/LCO2 PJT');
    expect(html).toContain('순회 구간 : GSC현장');
    expect(html).toContain('당일 허가서 작업명이 없습니다.');
    expect(html).toContain('날씨 : 맑음');
    expect(html).toContain('안전모 미착용');
    expect(html).toContain('before.jpg');
    expect(html).toContain('재교육 완료');
    expect(html).toContain('after.jpg');
    expect(html).toContain('walk1.jpg');
    expect(html).toContain('통로 정리 필요');
    expect(html).toContain('잔재 반출');
    expect(html).not.toContain('height:150px');
    const page1 = html.split('class="page-2"')[0];
    const page2 = html.split('class="page-2"')[1] || '';
    expect(page1).toContain('안전모 미착용');
    expect(page1).toContain('[사진 2쪽]');
    expect(page1).toContain('class="patrol-shot"');
    expect(page1).toContain('walk1.jpg');
    expect(page1).not.toContain('before.jpg');
    expect(page1).not.toContain('after.jpg');
    expect(page1).not.toContain('class="photos"');
    expect(page1).toContain('class="patrol-photos"');
    expect(page2).toContain(PATROL_FINDING_PHOTO_SHEET_TITLE);
    expect(page2).toContain('before.jpg');
    expect(page2).toContain('after.jpg');
    expect(page2).toContain('class="finding-shot"');
    expect(page2).not.toContain('walk1.jpg');
  });

  it('omits the finding photo sheet when there are no 지적 photos', () => {
    const html = buildPatrolLogHtml({
      projectName: '현장',
      inspectedAt: '2026-08-24T00:00:00.000Z',
      inspectorName: '김안전',
      location: '',
      items: [{ label: '근로자 개인보호구 착용상태', result: 'pass' }],
      actions: [],
      patrolPhotos: ['https://example.test/walk1.jpg'],
    });
    expect(html).toContain(PATROL_WALK_PHOTO_LABEL);
    expect(html).not.toContain(PATROL_FINDING_PHOTO_SHEET_TITLE);
    expect(html).not.toContain('class="page-2"');
    expect(html).not.toContain('[사진 2쪽]');
  });

  it('collects finding and action photos for the second sheet', () => {
    const sheets = collectFindingPhotoSheets(
      [{
        label: '고소작업시 난간설치상태',
        result: 'fail',
        note: '난간 미설치',
        photos: ['https://example.test/p.jpg'],
      }],
      [{ issue: '고소작업시 난간설치상태', evidence_photos: ['https://example.test/fix.jpg'] }],
    );
    expect(sheets).toHaveLength(1);
    expect(sheets[0].index).toBe(1);
    expect(sheets[0].findingUrls).toEqual(['https://example.test/p.jpg']);
    expect(sheets[0].actionUrls).toEqual(['https://example.test/fix.jpg']);
  });

  it('maps 결재선 to SM and 현장소장 stamp slots', () => {
    const stamps = pickPatrolPrintStamps([
      {
        step: '안전관리자',
        position: 'contractor_safety_manager',
        approver_name: '박상우',
        status: '승인',
        approved_at: '2026-08-26T06:00:00.000Z',
        step_order: 0,
      },
      {
        step: '안전보건관리책임자(현장소장)',
        position: 'contractor_site_director',
        approver_name: '김소장',
        status: '진행중',
        step_order: 1,
      },
    ]);
    expect(stamps.sm?.name).toBe('박상우');
    expect(stamps.director?.name).toBe('김소장');
    const html = buildPatrolLogHtml({
      projectName: '현장',
      inspectedAt: '2026-08-26T00:00:00.000Z',
      inspectorName: '작성자',
      location: '구간',
      items: [],
      actions: [],
      stamps,
    });
    expect(html).toContain('박상우');
    expect(html).toContain('김소장');
    expect(html).toContain('대기');
    expect(html).not.toContain('작성자 /');
    expect(html).toContain('결<br/>재');
  });

  it('does not put 순회 구간 into 작업내용', () => {
    const html = buildPatrolLogHtml({
      projectName: '현장',
      inspectedAt: '2026-08-26T00:00:00.000Z',
      inspectorName: '작성자',
      location: 'GSC 여수 H2 LCO2 토목 및 건축공사 현장',
      workItems: [],
      items: [],
      actions: [],
    });
    const workCell = html.split('작 업 내 용')[1] || '';
    expect(workCell).toContain('당일 허가서 작업명이 없습니다.');
    expect(workCell.split('점 검 사 항')[0]).not.toContain('GSC 여수 H2 LCO2 토목 및 건축공사 현장');
  });
});
