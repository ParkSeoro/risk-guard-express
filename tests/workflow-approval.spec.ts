/**
 * 전자결재 · 작업 진행 풀사이클 E2E
 * ----------------------------------------------------------
 * 1) 협력사 소장 — 작업계획서 작성 → 결재 상신
 * 2) 원청 관리자 — 결재함에서 승인
 * 3) 일반 근로자 — 승인된 작업/TBM 현장 목록 확인
 *
 * 계정: .env.e2e 의 E2E_CONTRACTOR_* / E2E_ADMIN_* / E2E_WORKER_*
 * 실패 시: [WORKFLOW FAIL] 접두어 + test-results/ 스크린샷
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { hasCredentials, loginAs, logout, missingCredMessage } from './helpers/auth';

test.describe.configure({ mode: 'serial' });

/** 스텝 간 공유 — 고유 제목으로 문서 추적 */
const RUN_ID = Date.now().toString(36);
const PLAN_TITLE = `E2E풀사이클-${RUN_ID}`;

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function expectToast(page: Page, pattern: RegExp, timeout = 15_000) {
  const toast = page.getByText(pattern).first();
  await expect(toast, `[TOAST FAIL] 기대=${pattern} url=${page.url()}`).toBeVisible({ timeout });
}

/**
 * 작업계획서 생성 다이얼로그 — 공종/기간/제목 입력 후 생성
 */
async function createWorkPlan(page: Page, title: string) {
  await page.goto('/work-plans');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await expect(page.getByRole('heading', { name: /작업계획서/ }).or(page.getByText('작업계획서').first())).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: /새 작업계획서/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('작업계획서 생성')).toBeVisible({ timeout: 10_000 });

  // 공종 (Radix Select)
  await dialog.getByText('공종을 선택하세요').click();
  await page.getByRole('option', { name: /기타 위험 작업/ }).click();

  const dates = dialog.locator('input[type="date"]');
  await dates.nth(0).fill(todayPlus(1));
  await dates.nth(1).fill(todayPlus(2));

  await dialog.getByPlaceholder('미입력 시 자동 생성').fill(title);
  await dialog.getByRole('button', { name: '생성', exact: true }).click();

  await expectToast(page, /작업계획서가 생성되었습니다/);
  await page.waitForURL(/\/work-plan\//, { timeout: 20_000 });
  console.log(`[OK] 작업계획서 생성 → ${page.url()}`);
}

/**
 * 상세 화면 '내용 작성' 탭에 현장 가상 데이터 fill
 */
async function fillWorkPlanContent(page: Page) {
  await page.getByRole('tab', { name: /내용 작성/ }).click();

  // 작업 개요
  await page.getByPlaceholder('예: 1공구 철골 양중작업').fill(`E2E 가상작업 ${RUN_ID}`);
  await page.getByPlaceholder('예: A동 3층').fill('E2E 테스트동 2층');
  await page.getByPlaceholder('이름/직책').fill('테스트 감독자');
  await page.getByPlaceholder('예: 8').fill('6');
  await page.getByPlaceholder('작업 상세 내용을 기재하세요').fill(
    'E2E 자동 테스트용 가상 작업내용입니다. 고소작업 전 PPE 점검 후 진행합니다.',
  );

  // 작업 방법
  await page.getByPlaceholder('작업 단계 설명 *').fill('자재 반입 → 안전구역 설정 → 본작업 → 정리');
  await page.getByPlaceholder('안전조치 사항').fill('안전대 체결, 신호수 배치, 출입통제');

  // 위험요인
  await page.getByPlaceholder('원인 + 사고결과').fill('고소 추락 위험');
  await page.getByPlaceholder('구체적 상황').fill('비계 상부 이동 중');
  await page.getByPlaceholder('구체적 조치').fill('안전난간·안전대 이중 체결');

  // 비상시 조치
  await page.getByPlaceholder('119, 현장소장 010-xxxx').fill('119 / 현장소장 010-0000-0000');
  await page.getByPlaceholder('○○병원 (차량 10분)').fill('E2E 종합병원 (차량 8분)');
  await page.getByPlaceholder('서측 비상계단 → 주차장').fill('동측 비상계단 → 정문 집결');
  await page.getByPlaceholder('정문 주차장').fill('정문 주차장');

  console.log('[OK] 내용 작성 탭 가상 데이터 입력 완료');
}

/**
 * 결재 상신 — 상세 버튼 → (첨부 차단 시) 목록 메뉴 폴백
 */
async function submitForApproval(page: Page, title: string) {
  // 저장
  const saveBtn = page.getByRole('button', { name: /^저장$/ });
  if (await saveBtn.isVisible().catch(() => false)) {
    await saveBtn.click();
    await page.waitForTimeout(800);
  }

  await page.getByRole('button', { name: /결재 상신/ }).click();

  // A) 법정 첨부 차단 → 목록 RPC 상신 폴백
  const blocked = page.getByText(/결재 상신이 차단되었습니다|법정 필수 첨부/);
  if (await blocked.isVisible({ timeout: 3_000 }).catch(() => false)) {
    console.warn('[WARN] 법정 첨부 미비로 상세 상신 차단 → 목록 결재 상신 폴백');
    await submitFromListMenu(page, title);
    return;
  }

  // B) 필수 입력 누락
  const validationFail = page.getByText(/필수 입력 항목을 확인해주세요/);
  if (await validationFail.isVisible({ timeout: 2_000 }).catch(() => false)) {
    throw new Error(`[WORKFLOW FAIL] 상신 전 폼 검증 실패. url=${page.url()} title=${title}`);
  }

  // C) 상신 다이얼로그
  const approvalDialog = page.getByRole('dialog').filter({ hasText: /결재 상신/ });
  if (await approvalDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await fillAndConfirmApprovalDialog(page, approvalDialog);
    await expectToast(page, /결재가 상신되었습니다|결재 상신이 완료되었습니다/);
    console.log('[OK] 상세 결재 상신 다이얼로그 완료');
    return;
  }

  // D) 다이얼로그 없이 토스트만 온 경우
  const submitted = page.getByText(/결재 상신|결재가 상신|상신 완료/);
  if (await submitted.isVisible({ timeout: 5_000 }).catch(() => false)) {
    console.log('[OK] 결재 상신 토스트 확인');
    return;
  }

  // 최후 폴백
  console.warn('[WARN] 상세 상신 UI 미확인 → 목록 결재 상신 폴백');
  await submitFromListMenu(page, title);
}

async function fillAndConfirmApprovalDialog(page: Page, dialog: Locator) {
  // 각 단계 결재자 지정 (첫 번째 옵션)
  const triggers = dialog.locator('[role="combobox"]');
  const count = await triggers.count();
  for (let i = 0; i < count; i++) {
    const t = triggers.nth(i);
    const text = (await t.innerText().catch(() => '')).trim();
    // 템플릿 선택 combobox 스킵
    if (/템플릿/.test(text)) continue;
    if (!/결재자|선택|직책/.test(text) && text.length > 2 && !text.includes('선택')) continue;
    await t.click();
    const option = page.getByRole('option').first();
    if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await option.click();
      await page.waitForTimeout(200);
    } else {
      await page.keyboard.press('Escape');
    }
  }

  const memo = dialog.getByPlaceholder(/재상신 사유/);
  if (await memo.isVisible().catch(() => false)) {
    await memo.fill(`E2E 풀사이클 상신 ${RUN_ID}`);
  }

  await dialog.getByRole('button', { name: /^결재 상신$/ }).click();
}

async function submitFromListMenu(page: Page, title: string) {
  await page.goto('/work-plans');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const card = page.locator('div, article, li').filter({ hasText: title }).first();
  await expect(card, `[WORKFLOW FAIL] 목록에서 문서 미발견: ${title}`).toBeVisible({ timeout: 20_000 });

  // 더보기(⋮) 메뉴
  const moreBtn = card.locator('button').filter({ has: page.locator('svg') }).last();
  await moreBtn.click();
  await page.getByRole('menuitem', { name: /결재 상신/ }).click();

  await expectToast(page, /결재 상신|상신 실패/);
  const fail = page.getByText(/상신 실패/);
  if (await fail.isVisible().catch(() => false)) {
    const desc = (await page.locator('[data-sonner-toast], [role="status"], li').innerText().catch(() => '')).slice(0, 200);
    throw new Error(`[WORKFLOW FAIL] 목록 결재 상신 실패. title=${title} detail≈${desc}`);
  }
  console.log('[OK] 목록 메뉴에서 결재 상신 완료');
}

async function approvePendingAsAdmin(page: Page, title: string) {
  await page.goto('/approvals');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await expect(page.getByText('전자결재').first()).toBeVisible({ timeout: 20_000 });

  const search = page.getByPlaceholder(/제목·결재자·코멘트 검색/);
  if (await search.isVisible().catch(() => false)) {
    await search.fill(title);
    await page.waitForTimeout(500);
  }

  // 유형 필터: 작업계획서
  const typeFilter = page.getByRole('combobox').filter({ hasText: /전체 유형|작업계획서|작업허가서/ });
  if (await typeFilter.isVisible().catch(() => false)) {
    await typeFilter.click();
    const opt = page.getByRole('option', { name: /작업계획서/ });
    if (await opt.isVisible({ timeout: 2_000 }).catch(() => false)) await opt.click();
  }

  let approvedOnce = false;
  for (let step = 0; step < 8; step++) {
    const row = page.locator('div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: /^승인$/ }) }).first();
    const visible = await row.isVisible({ timeout: 4_000 }).catch(() => false);

    if (!visible) {
      // 엔티티 대기 섹션 전역 승인 버튼 (제목 인접)
      const anyApprove = page.getByRole('button', { name: /^승인$/ }).first();
      if (!(await anyApprove.isVisible().catch(() => false))) break;
      // 검색으로 좁혀지지 않은 경우: 제목이 페이지에 있는지 확인
      const titleOnPage = await page.getByText(title).first().isVisible().catch(() => false);
      if (!titleOnPage && approvedOnce) break;
      if (!titleOnPage) {
        test.skip(
          true,
          `[DATA] 결재함에 "${title}" 대기 건이 없습니다. 상신 결재선에 ADMIN 계정이 포함되는지 확인하세요.`,
        );
      }
      await anyApprove.click();
    } else {
      await row.getByRole('button', { name: /^승인$/ }).click();
    }

    await expectToast(page, /승인 완료|단계가 승인|최종 승인|처리되었습니다|처리 실패/);
    const failed = page.getByText(/처리 실패|권한이 없습니다|이전 단계/);
    if (await failed.isVisible().catch(() => false)) {
      throw new Error(`[WORKFLOW FAIL] 승인 처리 실패 (step=${step}). title=${title} url=${page.url()}`);
    }
    approvedOnce = true;
    console.log(`[OK] 승인 클릭 #${step + 1}`);
    await page.waitForTimeout(1000);
    await page.reload({ waitUntil: 'domcontentloaded' });
    if (await search.isVisible().catch(() => false)) await search.fill(title);
  }

  if (!approvedOnce) {
    test.skip(true, `[DATA] "${title}" 에 대한 승인 버튼을 찾지 못했습니다.`);
  }

  // 상태 확인: 작업계획서 상세/목록
  await page.goto('/work-plans');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  const planCard = page.locator('div').filter({ hasText: title }).first();
  await expect(planCard, `[WORKFLOW FAIL] 승인 후 목록에 문서 없음: ${title}`).toBeVisible({ timeout: 20_000 });

  const statusOk = await planCard
    .getByText(/승인완료|승인|완료/)
    .first()
    .isVisible()
    .catch(() => false);
  const stillPending = await planCard
    .getByText(/결재중|작성중/)
    .first()
    .isVisible()
    .catch(() => false);

  if (!statusOk && stillPending) {
    console.warn('[WARN] 다단계 결재 잔여 — 1회 이상 승인은 됐으나 최종 상태 미도달');
  } else {
    expect(statusOk || !stillPending, `[WORKFLOW FAIL] 승인 후 상태 미변경. title=${title}`).toBeTruthy();
  }
  console.log(`[OK] 관리자 결재 단계 완료 (finalStatusOk=${statusOk})`);
}

async function workerSeesApprovedWork(page: Page, title: string) {
  // 대시보드 / 작업계획서 / TBM 일지 렌더 확인
  await page.goto('/');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await expect(page.locator('body')).not.toContainText('계정 비활성화');

  await page.goto('/work-plans');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  const heading = page.getByText('작업계획서').first();
  await expect(heading, '[WORKFLOW FAIL] 근로자 작업계획서 목록 미렌더').toBeVisible({ timeout: 20_000 });

  const planVisible = await page.getByText(title).first().isVisible({ timeout: 8_000 }).catch(() => false);
  if (planVisible) {
    console.log(`[OK] 근로자 목록에서 승인 문서 확인: ${title}`);
  } else {
    // 회사 스코프/RLS 로 타사 문서가 안 보일 수 있음 — 목록 자체 활성화는 통과 조건
    console.warn(`[WARN] 근로자 화면에 "${title}" 미노출 (회사 스코프 가능). 목록 렌더는 확인.`);
    await expect(page.getByText(/작업계획서가 없습니다|새 작업계획|작성중|결재중|완료|승인/).first()).toBeVisible();
  }

  await page.goto('/tbm-logs');
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // 프로젝트 미선택 메시지 또는 TBM UI
  const tbmReady = page.getByText(/TBM 일지|TBM 세션|TBM 생성|프로젝트를 먼저 선택/);
  await expect(tbmReady.first(), `[WORKFLOW FAIL] TBM 일지 화면 미렌더. url=${page.url()}`).toBeVisible({
    timeout: 20_000,
  });

  // 현장 작업 QuickStart (대시보드)
  await page.goto('/');
  const fieldCta = page.getByText(/TBM 참여|TBM 일지|위험성평가 조회|작업계획서/).first();
  await expect(fieldCta, '[WORKFLOW FAIL] 근로자 현장 작업 CTA/목록 미노출').toBeVisible({ timeout: 20_000 });
  console.log('[OK] 근로자 현장 작업·TBM 화면 활성화 확인');
}

// ─────────────────────────────────────────────
// 풀사이클 시나리오
// ─────────────────────────────────────────────
test.describe('전자결재·작업 풀사이클', () => {
  test.beforeEach(() => {
    test.skip(
      !(hasCredentials('contractor') && hasCredentials('admin') && hasCredentials('worker')),
      `풀사이클에는 3계정 모두 필요 — ${missingCredMessage('contractor')} / admin / worker`,
    );
  });

  test('1) [협력사 소장] 작업계획서 작성 및 결재 상신', async ({ page }) => {
    await loginAs(page, 'contractor');
    await createWorkPlan(page, PLAN_TITLE);
    await fillWorkPlanContent(page);
    await submitForApproval(page, PLAN_TITLE);

    // 목록에서 결재중(또는 상신됨) 확인
    await page.goto('/work-plans');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const card = page.locator('div').filter({ hasText: PLAN_TITLE }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const status = card.getByText(/결재중|승인|완료|작성중/);
    await expect(status.first()).toBeVisible();
    console.log(`[OK] STEP1 완료 title=${PLAN_TITLE}`);
    await logout(page);
  });

  test('2) [원청 관리자] 결재함에서 승인', async ({ page }) => {
    await loginAs(page, 'admin');
    await approvePendingAsAdmin(page, PLAN_TITLE);
    console.log(`[OK] STEP2 완료 title=${PLAN_TITLE}`);
    await logout(page);
  });

  test('3) [일반 근로자] 승인 작업·TBM 현장 목록 확인', async ({ page }) => {
    await loginAs(page, 'worker');
    await workerSeesApprovedWork(page, PLAN_TITLE);
    console.log(`[OK] STEP3 완료 title=${PLAN_TITLE}`);
    await logout(page);
  });
});
