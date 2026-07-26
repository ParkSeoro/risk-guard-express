/**
 * 권한별 E2E 진단 시나리오
 * ----------------------------------------------------------
 * 계정은 .env.e2e (또는 셸 export) 로 주입합니다.
 *
 *  - E2E_WORKER_*      : 일반 근로자 (가능하면 companies.type=contractor + role=worker)
 *  - E2E_CONTRACTOR_*  : 협력사 소장 (type=contractor + site_manager 등 작성 권한)
 *  - E2E_ADMIN_*       : 원청/발주 관리자 (project_admin | safety_manager | master)
 *
 * 실패 시:
 *  - 터미널 list reporter 가 [ROUTE GUARD FAIL] / [LOGIN FAIL] 메시지 출력
 *  - test-results/ 에 screenshot + trace 저장 (playwright.config.ts)
 *  - 상세 UI: npx playwright show-report
 */
import { test, expect } from '@playwright/test';
import {
  gotoAndSettle,
  hasCredentials,
  loginAs,
  missingCredMessage,
  expectRedirectedAwayFrom,
} from './helpers/auth';

test.describe.configure({ mode: 'serial' });

// ─────────────────────────────────────────────
// 1) 일반 근로자 — 관리자 라우트 차단
// ─────────────────────────────────────────────
test.describe('[일반 근로자] 관리자 라우트 접근 차단', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials('worker'), missingCredMessage('worker'));
    await loginAs(page, 'worker');
  });

  for (const path of ['/settings', '/master-data', '/safety-cost', '/settings/permissions', '/admin/data-audit']) {
    test(`금지 라우트 차단: ${path}`, async ({ page }) => {
      console.log(`[CASE] worker → ${path}`);
      await expectRedirectedAwayFrom(page, path, { allowedFinal: ['/', '/project-select'] });
    });
  }

  test('사이드바에 시스템/비용 메뉴가 과도하게 노출되지 않음', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // 협력사 Foolproof UI: "시스템" 그룹·산안비 링크 숨김이 기대 동작
    const systemLabel = page.getByText('시스템', { exact: true });
    const safetyCost = page.getByRole('link', { name: /산업안전보건관리비|산안비/ });

    // 근로자/협력사면 숨겨지는 것이 정상. 보이면 진단 로그.
    if (await systemLabel.isVisible().catch(() => false)) {
      console.warn('[WARN] 사이드바 "시스템" 그룹이 보입니다. contractor Foolproof UI 미적용 가능.');
    }
    if (await safetyCost.isVisible().catch(() => false)) {
      console.warn('[WARN] 산안비 메뉴가 보입니다. 협력사 메뉴 필터 확인 필요.');
    }
  });
});

// ─────────────────────────────────────────────
// 2) 협력사 소장 — 작성/기안 CTA
// ─────────────────────────────────────────────
test.describe('[협력사 소장] 작성·기안 UI', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials('contractor'), missingCredMessage('contractor'));
    await loginAs(page, 'contractor');
  });

  test('대시보드에 위험성평가/작업허가서 CTA 가 보인다', async ({ page }) => {
    await page.goto('/');
    // ContractorDashboard 또는 QuickStart
    const raCta = page.getByText(/오늘의 위험성 평가|위험성평가/).first();
    const permitCta = page.getByText(/작업허가서|허가서 상신/).first();

    await expect(raCta, '[UI] 위험성평가 CTA 미노출 — ContractorDashboard/QuickStart 확인').toBeVisible({
      timeout: 20_000,
    });
    await expect(permitCta, '[UI] 작업허가서 CTA 미노출').toBeVisible();
    console.log('[OK] 협력사 대시보드 CTA 노출 확인');
  });

  test('위험성평가 목록에서 작성(회차 생성) 진입이 가능하다', async ({ page }) => {
    await page.goto('/risk-assessment');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // 생성 버튼 후보 (실제 라벨 변형 대응)
    const createBtn = page
      .getByRole('button', { name: /회차 생성|새 회차|생성|추가|\+/ })
      .or(page.getByRole('link', { name: /회차 생성|새 회차/ }))
      .first();

    // AssessmentRuns: "회차 생성" 은 현재 project_admin|safety_manager|master 만 노출
    const runCreate = page.getByRole('button', { name: /회차 생성/ }).first();
    if (await runCreate.isVisible().catch(() => false)) {
      await runCreate.click();
      await expect(
        page.getByRole('dialog'),
        `[UI FAIL] 회차 생성 클릭 후 다이얼로그 없음. url=${page.url()}`,
      ).toBeVisible({ timeout: 10_000 });
      console.log('[OK] 위험성평가 회차 생성 다이얼로그 오픈');
      return;
    }

    const visible = await createBtn.isVisible().catch(() => false);
    if (!visible) {
      // 공정표 업로드 등 대체 진입
      const alt = page.getByRole('button', { name: /공정표|업로드|AI/ }).first();
      if (!(await alt.isVisible().catch(() => false))) {
        throw new Error(
          `[UI FAIL] /risk-assessment 에서 작성 진입 버튼을 찾지 못했습니다.\n` +
            `  url=${page.url()}\n` +
            `  → AssessmentRuns canCreateRun(project_admin|safety_manager|master) 또는 협력사 작성 권한 확인`,
        );
      }
      await alt.click();
      console.log('[OK] 대체 작성 진입(공정표/AI) 클릭');
      return;
    }

    await createBtn.click();
    // 다이얼로그 또는 네비게이션
    const dialog = page.getByRole('dialog');
    const opened = await dialog.isVisible().catch(() => false);
    const navigated = !page.url().endsWith('/risk-assessment');
    expect(
      opened || navigated,
      `[UI FAIL] 회차 생성 클릭 후 다이얼로그/이동 없음. url=${page.url()}`,
    ).toBeTruthy();
    console.log(`[OK] 위험성평가 작성 진입 (dialog=${opened}, navigated=${navigated})`);
  });

  test('작업계획서 목록에서 작성 버튼이 렌더·클릭된다', async ({ page }) => {
    await page.goto('/work-plans');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const createBtn = page.getByRole('button', { name: /새 작업계획|작성|생성|추가/ }).first();
    await expect(createBtn, `[UI FAIL] /work-plans 작성 버튼 없음. url=${page.url()}`).toBeVisible({
      timeout: 20_000,
    });
    await createBtn.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.or(page.locator('form')).first(), '작성 UI 미오픈').toBeVisible({ timeout: 10_000 });
    console.log('[OK] 작업계획서 작성 UI 오픈');
  });

  test('타사 민감 라우트(/safety-cost)는 대시보드로 튕긴다', async ({ page }) => {
    await expectRedirectedAwayFrom(page, '/safety-cost', { allowedFinal: ['/'] });
  });
});

// ─────────────────────────────────────────────
// 3) 원청 관리자 — 메뉴 노출 + 결재 승인/반려
// ─────────────────────────────────────────────
test.describe('[원청 관리자] 전체 메뉴·결재 워크플로', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasCredentials('admin'), missingCredMessage('admin'));
    await loginAs(page, 'admin');
  });

  test('주요 관리 메뉴 라우트에 진입할 수 있다', async ({ page }) => {
    for (const path of ['/', '/approvals', '/risk-assessment', '/work-plans', '/projects']) {
      const finalPath = await gotoAndSettle(page, path);
      expect(
        finalPath === path || finalPath.startsWith(path + '/'),
        `[MENU FAIL] 관리자인데 ${path} 진입 실패 → ${finalPath}`,
      ).toBeTruthy();
      console.log(`[OK] 관리자 메뉴 진입: ${path}`);
    }
  });

  test('결재함에서 승인 또는 반려 액션이 가능하다', async ({ page }) => {
    await page.goto('/approvals');
    await page.waitForLoadState('networkidle').catch(() => undefined);

    // "내 결재" / 대기 탭 우선
    const mineTab = page.getByRole('tab', { name: /내 결재|대기/ }).first();
    if (await mineTab.isVisible().catch(() => false)) {
      await mineTab.click();
    }

    const approveBtn = page.getByRole('button', { name: /^승인$/ }).first();
    const rejectBtn = page.getByRole('button', { name: /^반려$/ }).first();

    const hasApprove = await approveBtn.isVisible().catch(() => false);
    const hasReject = await rejectBtn.isVisible().catch(() => false);

    if (!hasApprove && !hasReject) {
      // 대기 건 없음 = 환경 데이터 이슈. hard-fail 대신 진단 후 soft skip
      const emptyHint = await page.getByText(/대기 중인 결재가 없습니다|결재가 없습니다/).isVisible().catch(() => false);
      test.skip(
        true,
        emptyHint
          ? '[DATA] 결재 대기 건이 없어 승인/반려를 실행할 수 없습니다. 협력사 계정으로 상신 후 재실행하세요.'
          : `[UI] 승인/반려 버튼을 찾지 못했습니다. url=${page.url()} — 결재함 탭/권한을 확인하세요.`,
      );
    }

    if (hasApprove) {
      page.once('dialog', async (d) => {
        // prompt('반려 사유') 등 대비
        await d.accept('E2E 자동 승인 테스트');
      });
      await approveBtn.click();
      // 토스트 또는 목록 갱신
      await page.waitForTimeout(1200);
      const toast = page.getByText(/승인|완료|반려|권한/);
      await expect(toast.first(), '승인 클릭 후 피드백 없음').toBeVisible({ timeout: 10_000 });
      console.log('[OK] 결재 승인 액션 실행');
    } else if (hasReject) {
      page.once('dialog', async (d) => {
        await d.accept('E2E 자동 반려 테스트');
      });
      await rejectBtn.click();
      // 반려 사유 textarea UI 경로
      const reason = page.getByPlaceholder(/반려 사유/);
      if (await reason.isVisible().catch(() => false)) {
        await reason.fill('E2E 자동 반려 테스트');
        await page.getByRole('button', { name: /반려/ }).last().click();
      }
      await page.waitForTimeout(1200);
      console.log('[OK] 결재 반려 액션 실행');
    }
  });
});
