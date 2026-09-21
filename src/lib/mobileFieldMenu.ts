/** Manager 현장 / 더보기 IA — one place so tabs do not dump the same links. */

export type MobileFieldItem = {
  key: string;
  label: string;
  sub: string;
  to: string;
};

export type MobileFieldSection = {
  key: string;
  title: string;
  items: MobileFieldItem[];
};

export function managerFieldSections(): MobileFieldSection[] {
  return [
    {
      key: "watch",
      title: "관제",
      items: [
        {
          key: "vision",
          label: "비전 관제",
          sub: "현장 카메라 라이브",
          to: "/app/worker/vision-events",
        },
      ],
    },
    {
      key: "inspect",
      title: "점검·조치",
      items: [
        { key: "inspect", label: "안전점검", sub: "현장 점검 등록", to: "/app/worker/inspect" },
        { key: "actions", label: "조치 관리", sub: "진행·완료 확인", to: "/app/worker/actions" },
        { key: "work-stop", label: "작업중지", sub: "접수·처리중 확인", to: "/app/worker/work-stop" },
        { key: "incident", label: "사고 신고", sub: "아차/경미/중대", to: "/app/worker/incident" },
      ],
    },
    {
      key: "people",
      title: "사람",
      items: [
        { key: "tbm", label: "TBM 진행", sub: "QR·참여 관리", to: "/app/worker/tbm" },
        { key: "workers", label: "근로자", sub: "명부·입퇴장·서명", to: "/app/worker/workers" },
        {
          key: "distribution",
          label: "근로자 분포",
          sub: "출근·구역 · 권한별 범위",
          to: "/app/worker/distribution",
        },
      ],
    },
    {
      key: "site",
      title: "현장 환경",
      items: [
        {
          key: "weather",
          label: "현장 일기예보",
          sub: "레이더·시간별·영향분석",
          to: "/app/worker/site-weather",
        },
        { key: "ppe", label: "보호구 수령확인", sub: "지급대기 서명", to: "/app/worker/ppe-receipt" },
      ],
    },
  ];
}

export type MobileMoreLink = {
  key: string;
  labelKey:
    | "menuAlerts"
    | "menuAlertSettings"
    | "menuApprovedDocs"
    | "menuQr"
    | "menuAccount"
    | "menuManual"
    | "menuLocation";
  to: string;
};

/** Settings / account + in-shell 사용 설명서. Vision and worker tools live on 현장. */
export function managerMoreLinks(_includeManual = true): MobileMoreLink[] {
  return [
    { key: "alert-settings", labelKey: "menuAlertSettings", to: "/app/worker/notifications" },
    { key: "docs", labelKey: "menuApprovedDocs", to: "/app/worker/docs" },
    { key: "qr", labelKey: "menuQr", to: "/app/worker/scan" },
    { key: "account", labelKey: "menuAccount", to: "/app/worker/account" },
    { key: "manual", labelKey: "menuManual", to: "/app/worker/manual" },
  ];
}

export function workerMoreLinks(_includeManual = true): MobileMoreLink[] {
  return [
    { key: "alerts", labelKey: "menuAlerts", to: "/app/worker/alerts" },
    { key: "alert-settings", labelKey: "menuAlertSettings", to: "/app/worker/notifications" },
    { key: "location", labelKey: "menuLocation", to: "/app/worker/location" },
    { key: "qr", labelKey: "menuQr", to: "/app/worker/scan" },
    { key: "account", labelKey: "menuAccount", to: "/app/worker/account" },
    { key: "manual", labelKey: "menuManual", to: "/app/worker/manual" },
  ];
}

export function fieldMenuPaths(sections: MobileFieldSection[]): string[] {
  return sections.flatMap((section) => section.items.map((item) => item.to));
}
