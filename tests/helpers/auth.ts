import { expect, type Page } from '@playwright/test';

export type E2ERole = 'worker' | 'contractor' | 'admin';

const CREDENTIALS: Record<E2ERole, { email?: string; password?: string; label: string }> = {
  worker: {
    email: process.env.E2E_WORKER_EMAIL,
    password: process.env.E2E_WORKER_PASSWORD,
    label: '일반 근로자',
  },
  contractor: {
    email: process.env.E2E_CONTRACTOR_EMAIL,
    password: process.env.E2E_CONTRACTOR_PASSWORD,
    label: '협력사 소장',
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL,
    password: process.env.E2E_ADMIN_PASSWORD,
    label: '원청 관리자',
  },
};

/** 계정 env 가 없으면 해당 describe/test 를 skip 시키기 위한 체크 */
export function hasCredentials(role: E2ERole): boolean {
  const c = CREDENTIALS[role];
  return Boolean(c.email && c.password);
}

export function missingCredMessage(role: E2ERole): string {
  const map: Record<E2ERole, string> = {
    worker: 'E2E_WORKER_EMAIL / E2E_WORKER_PASSWORD',
    contractor: 'E2E_CONTRACTOR_EMAIL / E2E_CONTRACTOR_PASSWORD',
    admin: 'E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD',
  };
  return `[SKIP] ${CREDENTIALS[role].label} 계정 미설정 — .env.e2e 에 ${map[role]} 를 넣으세요.`;
}

/**
 * /auth 로그인 후 앱 셸(대시보드 또는 프로젝트 선택)까지 진입.
 * 실패 시 현재 URL·페이지 타이틀을 에러에 붙여 진단이 쉽게 함.
 */
export async function loginAs(page: Page, role: E2ERole): Promise<void> {
  const cred = CREDENTIALS[role];
  if (!cred.email || !cred.password) {
    throw new Error(missingCredMessage(role));
  }

  await page.goto('/auth');
  // Auth.tsx Label 은 htmlFor 미연결 → placeholder / type 으로 지정
  await page.getByPlaceholder('user@company.com').fill(cred.email);
  await page.locator('input[type="password"]').fill(cred.password);
  await page.getByRole('button', { name: '로그인', exact: true }).click();

  // 로그인 성공: landing/auth 를 벗어나 앱 영역으로
  try {
    await page.waitForURL((url) => !url.pathname.startsWith('/auth') && !url.pathname.startsWith('/landing'), {
      timeout: 25_000,
    });
  } catch (e) {
    const bodyHint = (await page.locator('body').innerText().catch(() => '')).slice(0, 280);
    throw new Error(
      `[LOGIN FAIL] role=${role} (${cred.label})\n` +
        `  email=${cred.email}\n` +
        `  url=${page.url()}\n` +
        `  pageText≈ ${bodyHint.replace(/\s+/g, ' ')}\n` +
        `  cause=${(e as Error).message}`,
    );
  }

  // 계정 승인 대기 / 비활성 화면이면 즉시 실패 (워크플로 진행 불가)
  const blocked = page.getByRole('heading', { name: /승인 대기|계정 비활성화/ });
  if (await blocked.isVisible().catch(() => false)) {
    throw new Error(
      `[ACCOUNT BLOCKED] role=${role} — 계정 상태가 pending/inactive 입니다. 관리자 승인 후 재실행하세요. url=${page.url()}`,
    );
  }
}

/** 보호 라우트 접근 후 최종 pathname 반환 (리다이렉트 대기) */
export async function gotoAndSettle(page: Page, path: string): Promise<string> {
  await page.goto(path);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  // SPA Navigate 가 한 틱 늦을 수 있음
  await page.waitForTimeout(400);
  return new URL(page.url()).pathname;
}

export async function expectRedirectedAwayFrom(
  page: Page,
  forbiddenPath: string,
  opts?: { allowedFinal?: string[] },
): Promise<void> {
  const finalPath = await gotoAndSettle(page, forbiddenPath);
  const allowed = opts?.allowedFinal ?? ['/'];
  const stillOnForbidden =
    finalPath === forbiddenPath || finalPath.startsWith(forbiddenPath + '/');

  if (stillOnForbidden) {
    throw new Error(
      `[ROUTE GUARD FAIL] 금지 라우트에 그대로 머물렀습니다.\n` +
        `  tried=${forbiddenPath}\n` +
        `  final=${finalPath}\n` +
        `  fullUrl=${page.url()}\n` +
        `  → ContractorGate / 권한 가드가 동작하지 않거나, 이 계정의 company.type 이 contractor 가 아닐 수 있습니다.`,
    );
  }

  expect(
    allowed.some((a) => finalPath === a || finalPath.startsWith(a + '/')),
    `[ROUTE GUARD] ${forbiddenPath} → 기대 목적지 ${allowed.join('|')} 중 하나, 실제=${finalPath}`,
  ).toBeTruthy();

  console.log(`[OK] 차단 확인: ${forbiddenPath} → ${finalPath}`);
}
