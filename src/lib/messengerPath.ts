import { prefersMobileAppShell } from "@/hooks/use-mobile";

export const MESSENGER_ADMIN_PATH = "/app/admin/messenger";
export const MESSENGER_MOBILE_PATH = "/app/worker/messenger";

/** Phone shell must stay under /app/worker. /app/admin/messenger is bounced home. */
export function messengerHomePath(opts?: { mobileShell?: boolean }): string {
  const mobile = opts?.mobileShell ?? (typeof window !== "undefined" && prefersMobileAppShell());
  return mobile ? MESSENGER_MOBILE_PATH : MESSENGER_ADMIN_PATH;
}
