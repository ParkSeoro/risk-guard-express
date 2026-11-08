/** The two logins already treated as the same director. The Air Liquide account is the one in daily use. */
const COUNCIL_DIRECTORS = [
  { id: "51c291bd-b434-4872-8995-e78f495b2e01", email: "seoro.park@airliquide.com" },
  { id: "5e780ffb-81c8-42ef-8eed-b27815785fd1", email: "psr1579@gmail.com" },
] as const;

export function canOpenCouncil(
  user: { id?: string | null; email?: string | null } | null | undefined,
): boolean {
  if (!user) return false;
  const email = user.email?.trim().toLowerCase() ?? "";
  return COUNCIL_DIRECTORS.some((director) => director.id === user.id || director.email === email);
}
