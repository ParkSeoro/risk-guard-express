import { Link } from "react-router-dom";

/**
 * 개인정보처리방침 — App Store / Google Play 등록용 공개 페이지.
 * 변호사 검토 전 초안이며, 실제 출시 전 법무 검토 후 수치/연락처를 갱신하세요.
 */
const Privacy = () => {
  const updatedAt = "2026-06-28";
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 text-sm leading-7 text-foreground">
      <header className="mb-8 border-b pb-4">
        <h1 className="text-2xl font-bold">개인정보처리방침</h1>
        <p className="mt-2 text-muted-foreground">최종 업데이트: {updatedAt}</p>
      </header>

      <section className="space-y-4">
        <p>
          SafeNex(이하 "회사")는 「개인정보 보호법」 및 「산업안전보건법」에 따라
          이용자의 개인정보를 보호하고 권익을 존중하기 위해 본 방침을 수립·공개합니다.
        </p>

        <h2 className="mt-6 text-lg font-semibold">1. 수집하는 개인정보 항목</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>필수: 이름, 이메일, 휴대전화번호, 소속 회사·부서·직책, 직종</li>
          <li>안전관리: 출퇴근 시각, QR 체크인 이력, TBM 서명, 법정 교육 이수 기록</li>
          <li>위치: 백그라운드 위치(현장 안전관리 목적, 사용자 명시적 허용 시에만 수집)</li>
          <li>기기: OS 버전, 앱 버전, 푸시 토큰(FCM/APNs)</li>
        </ul>

        <h2 className="mt-6 text-lg font-semibold">2. 수집·이용 목적</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>산업안전보건법상 위험성평가, 작업계획서, TBM, 점검, 사고관리 의무 이행</li>
          <li>근로자 자격·교육 이수 확인 및 출입 통제</li>
          <li>중대재해 발생 시 24시간 내 관계기관 보고 지원</li>
          <li>긴급 대피·경보 푸시 전송</li>
        </ul>

        <h2 className="mt-6 text-lg font-semibold">3. 보유·이용 기간</h2>
        <p>
          산업안전보건법 시행규칙에 따라 안전관리 기록은 <strong>3년</strong>,
          중대재해 관련 기록은 <strong>5년</strong> 보관 후 즉시 파기합니다.
        </p>

        <h2 className="mt-6 text-lg font-semibold">4. 제3자 제공</h2>
        <p>
          회사는 법령에 근거하거나 정보주체의 별도 동의 없이 개인정보를 외부에 제공하지 않습니다.
          중대재해 발생 시 고용노동부·소방서 등 관계기관에 법령상 의무로 제공할 수 있습니다.
        </p>

        <h2 className="mt-6 text-lg font-semibold">5. 위치정보 (모바일 앱)</h2>
        <p>
          백그라운드 위치는 <strong>오직 사용자가 OS 권한 다이얼로그에서 "항상 허용"을 선택한 경우</strong>에만
          수집되며, 근무 시간 외에는 추적되지 않습니다. 언제든 OS 설정에서 권한을 회수할 수 있습니다.
        </p>

        <h2 className="mt-6 text-lg font-semibold">6. 정보주체의 권리</h2>
        <p>
          열람·정정·삭제·처리정지 요구를 언제든지 행사할 수 있으며, 앱 내{" "}
          <Link to="/settings/account" className="underline">설정 → 계정 정보</Link>{" "}
          또는 아래 연락처로 요청 가능합니다.
        </p>

        <h2 className="mt-6 text-lg font-semibold">7. 개인정보 보호책임자</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>이름: (운영자 지정)</li>
          <li>이메일: privacy@safenex.org</li>
        </ul>

        <h2 className="mt-6 text-lg font-semibold">8. 변경 고지</h2>
        <p>
          본 방침은 법령 또는 서비스 변경에 따라 개정될 수 있으며, 개정 시 앱 공지사항을 통해
          최소 7일 전 고지합니다.
        </p>
      </section>

      <footer className="mt-12 border-t pt-4 text-xs text-muted-foreground">
        <Link to="/landing" className="underline">홈으로</Link>
      </footer>
    </main>
  );
};

export default Privacy;
