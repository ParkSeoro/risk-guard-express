/** The council room belongs to one director account. */
export const COUNCIL_DIRECTOR_USER_ID = "5e780ffb-81c8-42ef-8eed-b27815785fd1";
export const COUNCIL_DIRECTOR_EMAIL = "psr1579@gmail.com";

export function canOpenCouncil(
  user: { id?: string | null; email?: string | null } | null | undefined,
): boolean {
  if (!user?.id || !user.email) return false;
  return (
    user.id === COUNCIL_DIRECTOR_USER_ID &&
    user.email.trim().toLowerCase() === COUNCIL_DIRECTOR_EMAIL
  );
}
