// ================================================================
// Mobile QA scenarios — 모바일 라우트별 데이터/링크/브라우저 능력 검증
// ----------------------------------------------------------------
// 목적: 모바일 페이지가 "링크 없음 / 빈 화면 / 카메라 안됨" 같은
// 사용자 보고를 자동으로 잡아낸다. 각 모바일 라우트가 의존하는
// 데이터 소스(테이블/RPC/스토리지/브라우저 능력)를 점검한다.
// 경로 SSOT: WorkerAppRoutes.tsx (/app/worker/...)
// ================================================================

import { supabase } from "@/integrations/supabase/client";
import { runStep, StepResult, TestContext } from "./runner";
import { readActiveProjectId } from "@/lib/activeProject";

// 모바일 라우트 인벤토리 — WorkerAppRoutes.tsx 와 동기화 필수
export const MOBILE_ROUTES: Array<{
  path: string;
  label: string;
  requires:
    | { kind: "table"; name: string; project_scoped?: boolean }
    | { kind: "rpc"; name: string; sample_args: any }
    | { kind: "browser"; cap: "camera" | "https" | "service_worker" | "geolocation" }
    | { kind: "static" };
}> = [
  { path: "/app/worker/today", label: "오늘(홈)", requires: { kind: "static" } },
  { path: "/app/worker/tasks", label: "할 일", requires: { kind: "table", name: "todo_items", project_scoped: true } },
  { path: "/app/worker/docs", label: "승인 자료", requires: { kind: "static" } },
  { path: "/app/worker/more", label: "더보기", requires: { kind: "static" } },
  { path: "/app/worker/inspect", label: "안전점검", requires: { kind: "table", name: "safety_inspections", project_scoped: true } },
  { path: "/app/worker/alerts", label: "알림", requires: { kind: "table", name: "notifications" } },
  { path: "/app/worker/actions", label: "조치 관리", requires: { kind: "table", name: "safety_inspection_actions", project_scoped: true } },
  { path: "/app/worker/approvals", label: "전자결재", requires: { kind: "table", name: "approvals" } },
  { path: "/app/worker/workers", label: "근로자 QR", requires: { kind: "table", name: "workers", project_scoped: true } },
  { path: "/app/worker/risk-assessment", label: "위험성평가", requires: { kind: "table", name: "assessment_runs", project_scoped: true } },
  { path: "/app/worker/work-plans", label: "작업계획", requires: { kind: "table", name: "work_plans", project_scoped: true } },
  { path: "/app/worker/tbm", label: "TBM", requires: { kind: "table", name: "tbm_sessions", project_scoped: true } },
  { path: "/app/worker/permits", label: "허가서 조회", requires: { kind: "table", name: "work_permits", project_scoped: true } },
  { path: "/app/worker/incident", label: "사고 신고", requires: { kind: "table", name: "incident_reports", project_scoped: true } },
  { path: "/app/worker/scan", label: "QR 스캔(카메라)", requires: { kind: "browser", cap: "camera" } },
  { path: "/app/worker/work-stop", label: "작업중지", requires: { kind: "table", name: "work_stop_requests", project_scoped: true } },
  { path: "/app/worker/daily-health-log", label: "일일 건강일지", requires: { kind: "table", name: "worker_daily_health_logs", project_scoped: true } },
  { path: "/app/worker/geofence-drop", label: "원터치 위험구역", requires: { kind: "table", name: "restricted_zones", project_scoped: true } },
  { path: "/app/worker/map-calibration", label: "지도 GPS 보정", requires: { kind: "table", name: "site_maps", project_scoped: true } },
  { path: "/app/worker/site-weather", label: "현장 일기예보", requires: { kind: "static" } },
  // Public / auth entry points outside the shell
  {
    path: "/worker/register",
    label: "근로자 등록(Auth)",
    requires: {
      kind: "rpc",
      name: "complete_worker_roster_signup",
      // Required args so PostgREST resolves the function (empty {} looks like "missing RPC").
      sample_args: {
        _user_id: "00000000-0000-0000-0000-000000000000",
        _project_id: "00000000-0000-0000-0000-000000000000",
        _company_id: "00000000-0000-0000-0000-000000000000",
        _name: "__qa__",
        _phone: "01000000000",
        _job_type: null,
      },
    },
  },
  { path: "/worker/portal/:token", label: "레거시 포털→로그인 리다이렉트", requires: { kind: "static" } },
  { path: "/tbm/:token", label: "TBM 참여(QR)", requires: { kind: "rpc", name: "get_tbm_by_token", sample_args: { _token: "__qa__" } } },
];

// 라우트 등록 누락 감지 — export for external inventory checks
export const REGISTERED_MOBILE_PATHS = MOBILE_ROUTES.map((r) => r.path);

function checkBrowserCap(cap: "camera" | "https" | "service_worker" | "geolocation"): {
  pass: boolean;
  details: any;
  error_location?: string;
} {
  if (typeof window === "undefined") {
    return { pass: false, error_location: "브라우저 컨텍스트 없음 (SSR?)", details: {} };
  }
  switch (cap) {
    case "https": {
      const ok = window.isSecureContext === true;
      return {
        pass: ok,
        details: { protocol: window.location.protocol, secure: window.isSecureContext },
        error_location: ok ? undefined : "HTTPS 가 아님 → 카메라/푸시 비활성",
      };
    }
    case "camera": {
      const secure = window.isSecureContext === true;
      const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const ok = secure && hasMedia;
      return {
        pass: ok,
        details: { secure, hasMediaDevices: hasMedia },
        error_location: !secure
          ? "카메라 사용 불가: HTTPS 가 아닙니다"
          : !hasMedia
            ? "카메라 사용 불가: navigator.mediaDevices 미지원"
            : undefined,
      };
    }
    case "service_worker": {
      const ok = "serviceWorker" in navigator;
      return {
        pass: ok,
        details: { supported: ok },
        error_location: ok ? undefined : "Service Worker 미지원 → 푸시/오프라인 비활성",
      };
    }
    case "geolocation": {
      const ok = "geolocation" in navigator;
      return {
        pass: ok,
        details: { supported: ok },
        error_location: ok ? undefined : "Geolocation 미지원",
      };
    }
  }
}

export async function runMobileScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  // 0) 모바일 홈에 필요한 환경
  out.push(
    await runStep("mobile", "secure_context", async () => checkBrowserCap("https"))
  );
  out.push(
    await runStep("mobile", "service_worker", async () => checkBrowserCap("service_worker"))
  );
  out.push(
    await runStep("mobile", "geolocation", async () => checkBrowserCap("geolocation"))
  );
  out.push(
    await runStep("mobile", "selected_project_id", async () => {
      const id = typeof window !== "undefined" ? readActiveProjectId() : null;
      const matches = !!id && id === ctx.projectId;
      return {
        pass: !!id,
        details: { localStorage_value: id, test_project: ctx.projectId, matches },
        error_location: !id
          ? "활성 프로젝트가 비어있음 → 모바일 페이지 대부분 빈 화면"
          : !matches
            ? "선택된 프로젝트가 테스트 대상 프로젝트와 다름 (모바일은 localStorage 만 봄)"
            : undefined,
      };
    })
  );

  // 1) 라우트별 의존성 점검
  for (const route of MOBILE_ROUTES) {
    const stepKey = `route_${route.path.replace(/[^a-zA-Z0-9]/g, "_")}`.slice(0, 60);

    out.push(
      await runStep("mobile", stepKey, async () => {
        const r = route.requires;

        if (r.kind === "static") {
          return { pass: true, details: { route: route.path, kind: "static" } };
        }

        if (r.kind === "browser") {
          const c = checkBrowserCap(r.cap);
          return { ...c, details: { route: route.path, ...c.details, cap: r.cap } };
        }

        if (r.kind === "table") {
          let q = supabase.from(r.name as any).select("id", { count: "exact", head: true });
          if (r.project_scoped && ctx.projectId) {
            q = q.eq("project_id", ctx.projectId);
          }
          const { error, count } = await q;
          if (error) {
            return {
              pass: false,
              error_location: `테이블 ${r.name} 조회 실패: ${error.message}`,
              details: { route: route.path, table: r.name },
            };
          }
          return {
            pass: true,
            details: { route: route.path, table: r.name, row_count_in_project: count ?? 0 },
          };
        }

        if (r.kind === "rpc") {
          const { error } = await supabase.rpc(r.name as any, r.sample_args);
          const msg = error?.message || "";
          const missing = /Could not find the function|does not exist|schema cache/i.test(msg);
          return {
            pass: !missing,
            details: { route: route.path, rpc: r.name, soft_error: msg || null },
            error_location: missing ? `RPC ${r.name} 누락 → 라우트 ${route.path} 동작 불가` : undefined,
          };
        }

        return { pass: false, error_location: "unknown requirement kind", details: {} };
      })
    );
  }

  // 2) Storage 버킷 (모바일 사진 업로드 의존)
  out.push(
    await runStep("mobile", "storage_attachments_bucket", async () => {
      const { data, error } = await supabase.storage.from("attachments").list("", { limit: 1 });
      if (error) {
        return {
          pass: false,
          error_location: `attachments 버킷 접근 불가: ${error.message} → 사진 업로드 실패`,
          details: { bucket: "attachments" },
        };
      }
      return { pass: true, details: { bucket: "attachments", sample_size: data?.length ?? 0 } };
    })
  );

  return out;
}
