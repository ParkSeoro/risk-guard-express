/** profiles.account_status SSOT — do not hard-delete users (stamps/audit stay). */

export type AccountStatus = 'pending' | 'active' | 'inactive';

export function normalizeAccountStatus(status?: string | null): AccountStatus {
  const s = String(status || 'active').toLowerCase();
  if (s === 'pending' || s === 'inactive') return s;
  return 'active';
}

/** Blocked from using the app (worker + admin). */
export function isAccountLoginBlocked(status?: string | null): boolean {
  return normalizeAccountStatus(status) === 'inactive';
}

export function isAccountPending(status?: string | null): boolean {
  return normalizeAccountStatus(status) === 'pending';
}

export function signupIdentityErrorMessage(code?: string | null): string | null {
  const c = String(code || '').toUpperCase();
  if (c === 'PHONE_IN_USE') {
    return '이 전화번호로 이미 계정이 있습니다. 다른 아이디로 가입하지 말고, 기존 계정 로그인 또는 관리자 재활성화를 요청하세요.';
  }
  if (c === 'EMAIL_IN_USE') {
    return '이 이메일로 이미 계정이 있습니다. 기존 계정으로 로그인하세요.';
  }
  return null;
}

export function authBannedErrorMessage(raw?: string | null): string | null {
  const m = String(raw || '').toLowerCase();
  if (m.includes('banned') || m.includes('user is banned')) {
    return '로그인 차단된 계정입니다. 관리자에게 재활성화를 요청하세요.';
  }
  return null;
}
