import { describe, it, expect } from 'vitest';

/** Mirrors client/edge password policy used by forgot + admin reset flows. */
const isValidTempPassword = (pwd: string, confirm?: string) => {
  if (!pwd || pwd.length < 8) return false;
  if (confirm !== undefined && pwd !== confirm) return false;
  return true;
};

describe('password reset policy', () => {
  it('rejects short passwords', () => {
    expect(isValidTempPassword('short')).toBe(false);
    expect(isValidTempPassword('1234567')).toBe(false);
  });

  it('accepts 8+ char passwords', () => {
    expect(isValidTempPassword('12345678')).toBe(true);
    expect(isValidTempPassword('TempPass1!')).toBe(true);
  });

  it('requires confirm match when provided', () => {
    expect(isValidTempPassword('12345678', '12345678')).toBe(true);
    expect(isValidTempPassword('12345678', '87654321')).toBe(false);
  });
});
