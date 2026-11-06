export const DESKTOP_OTA_NEEDS_INSTALLER =
  "이 PC 프로그램은 업데이트를 받으려면 설치 파일을 한 번 다시 실행해야 합니다. 그 다음부터는 설치 파일 없이 자동으로 받아집니다.";

export const DESKTOP_OTA_STAGED =
  "새 버전을 받아 두었습니다. 프로그램을 완전히 종료한 뒤 다시 열면 적용됩니다.";

export const DESKTOP_OTA_DOWNLOAD_FAILED = "업데이트 파일을 받지 못했습니다.";

export interface DesktopStageReply {
  ok: boolean;
  pending: boolean;
  needsInstaller: boolean;
  message: string;
}

/** The local PC program answers with JSON. An HTML page means the installed program is too old. */
export function interpretDesktopStageReply(status: number, body: string): DesktopStageReply {
  const trimmed = (body || "").trim();
  const looksLikePage = status === 404 || trimmed.startsWith("<") || !trimmed.startsWith("{");
  if (looksLikePage) {
    return {
      ok: false,
      pending: false,
      needsInstaller: true,
      message: DESKTOP_OTA_NEEDS_INSTALLER,
    };
  }
  try {
    const json = JSON.parse(trimmed) as { ok?: boolean; pending?: boolean; error?: string };
    if (json.ok && json.pending) {
      return { ok: true, pending: true, needsInstaller: false, message: DESKTOP_OTA_STAGED };
    }
    if (json.ok) {
      return {
        ok: true,
        pending: false,
        needsInstaller: false,
        message: "새 버전 설치가 완료되었습니다.",
      };
    }
    const err = String(json.error || "").trim();
    return {
      ok: false,
      pending: false,
      needsInstaller: false,
      message: /[가-힣]/.test(err) ? err : DESKTOP_OTA_DOWNLOAD_FAILED,
    };
  } catch {
    return {
      ok: false,
      pending: false,
      needsInstaller: true,
      message: DESKTOP_OTA_NEEDS_INSTALLER,
    };
  }
}
