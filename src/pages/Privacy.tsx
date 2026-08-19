import { Link } from "react-router-dom";
import { CONSENT_DOCS } from "@/lib/legal/consentDocs";
import { LEGAL_EFFECTIVE_DATE, LEGAL_OPERATOR } from "@/lib/legal/operator";

/**
 * Play 스토어 / 공개 URL (/privacy).
 * 본문은 앱 내 동의서와 동일 소스(consentDocs)를 사용합니다.
 */
const Privacy = () => {
  const privacy = CONSENT_DOCS.privacy;
  const location = CONSENT_DOCS.location;
  const health = CONSENT_DOCS.health;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-foreground">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-2xl font-bold">개인정보처리방침</h1>
        <p className="mt-2 text-muted-foreground">
          {LEGAL_OPERATOR.tradeName} · 시행일 {LEGAL_EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-6">
        <p>
          본 페이지는 Google Play 및 웹 공개용 처리방침입니다. 앱 설치 후 최초 이용 시
          동일한 내용에 동의를 받습니다. 회사 공식 법무본이 확정되면 이 문서를 대체합니다.
        </p>

        <article className="whitespace-pre-wrap">{privacy.body}</article>

        <h2 className="text-lg font-semibold border-t pt-6">위치정보 수집·이용 (요지)</h2>
        <article className="whitespace-pre-wrap text-muted-foreground">{location.body}</article>

        <h2 className="text-lg font-semibold border-t pt-6">민감정보(건강) 수집·이용 (요지)</h2>
        <article className="whitespace-pre-wrap text-muted-foreground">{health.body}</article>

        <h2 className="text-lg font-semibold border-t pt-6">정보주체 권리 행사</h2>
        <p>
          근로자는 앱 내{" "}
          <Link to="/app/worker/account" className="underline">
            더보기 → 계정
          </Link>
          , 관리자는{" "}
          <Link to="/settings/account" className="underline">
            설정 → 계정 정보
          </Link>
          , 또는 {LEGAL_OPERATOR.privacyEmail} 로 요청할 수 있습니다.
        </p>
      </section>

      <footer className="mt-12 border-t pt-4 text-xs text-muted-foreground">
        <Link to="/landing" className="underline">
          홈으로
        </Link>
      </footer>
    </main>
  );
};

export default Privacy;
