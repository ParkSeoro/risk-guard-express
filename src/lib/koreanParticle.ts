/** Appends the grammatically correct Korean topic particle (`은` or `는`) based on final consonant (받침). */
export function withTopicParticle(word?: string | null): string {
  const s = String(word || '').trim();
  if (!s) return '';
  const lastCode = s.charCodeAt(s.length - 1);
  if (lastCode >= 0xac00 && lastCode <= 0xd7a3) {
    const hasBatchim = (lastCode - 0xac00) % 28 !== 0;
    return `${s}${hasBatchim ? '은' : '는'}`;
  }
  return `${s}은(는)`;
}
