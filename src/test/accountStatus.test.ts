import { describe, expect, it } from 'vitest';
import {
  authBannedErrorMessage,
  isAccountLoginBlocked,
  isAccountPending,
  normalizeAccountStatus,
  signupIdentityErrorMessage,
  workerAuthPasswordErrorMessage,
} from '@/lib/accountStatus';

describe('accountStatus', () => {
  it('treats inactive as login-blocked, pending as waiting', () => {
    expect(normalizeAccountStatus(null)).toBe('active');
    expect(isAccountLoginBlocked('inactive')).toBe(true);
    expect(isAccountLoginBlocked('active')).toBe(false);
    expect(isAccountPending('pending')).toBe(true);
    expect(isAccountPending('inactive')).toBe(false);
  });

  it('maps duplicate signup and banned-login copy', () => {
    expect(signupIdentityErrorMessage('PHONE_IN_USE')).toContain('전화번호');
    expect(signupIdentityErrorMessage('EMAIL_IN_USE')).toContain('이메일');
    expect(authBannedErrorMessage('User is banned')).toContain('로그인 차단');
    expect(authBannedErrorMessage('invalid password')).toBeNull();
    expect(workerAuthPasswordErrorMessage('Password should be at least 6 characters.')).toMatch(/뒤 4자리/);
  });
});
