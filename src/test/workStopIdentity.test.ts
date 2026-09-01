import { describe, expect, it } from "vitest";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";
import {
  ANONYMOUS_REPORTER_LABEL,
  WORK_STOP_LEGAL_CITE,
  WORK_STOP_MAX_PHOTOS,
  WORK_STOP_OPEN_STATUSES,
  buildWorkStopInsert,
  isWorkStopNotifyRecipient,
  isWorkStopOpenStatus,
  parseWorkStopPhotoUrls,
  serializeWorkStopPhotos,
  shouldShowHomeGpsCard,
  shouldShowHomeWorkStopCard,
  validateWorkStopForm,
  workStopDisplayName,
  workStopNotifyMessage,
} from "@/lib/workStop";

describe("work-stop identity", () => {
  it("lets the reporter choose anonymous vs real name", () => {
    const anon = buildWorkStopInsert({
      projectId: "p1",
      workerId: "w1",
      reporterUserId: "u1",
      reporterName: "홍길동",
      location: "3층",
      hazardDescription: "비계 흔들림",
      isAnonymous: true,
    });
    expect(anon.is_anonymous).toBe(true);
    expect(anon.reporter_name).toBe(ANONYMOUS_REPORTER_LABEL);
    expect(anon.worker_id).toBe("w1");
    expect(anon.reporter_user_id).toBe("u1");
    expect(anon.photo_url).toBeNull();

    const named = buildWorkStopInsert({
      projectId: "p1",
      reporterName: " 홍길동 ",
      hazardDescription: "낙하 위험",
      isAnonymous: false,
      photoUrl: "https://x/a.jpg",
    });
    expect(named.is_anonymous).toBe(false);
    expect(named.reporter_name).toBe("홍길동");
    expect(named.photo_url).toBe("https://x/a.jpg");
    expect(workStopDisplayName(named)).toBe("홍길동");
  });

  it("never shows the legal name when anonymous, even if reporter_name leaked", () => {
    expect(
      workStopDisplayName({ is_anonymous: true, reporter_name: "홍길동" }),
    ).toBe(ANONYMOUS_REPORTER_LABEL);
    expect(
      workStopNotifyMessage({
        is_anonymous: true,
        reporter_name: "홍길동",
        location: "지하 2층",
        hazard_description: "가스 냄새",
      }),
    ).toBe(`${ANONYMOUS_REPORTER_LABEL} · 지하 2층 — 가스 냄새`);
  });

  it("requires a name only for real-name reports", () => {
    expect(
      validateWorkStopForm({
        projectId: "p1",
        isAnonymous: true,
        reporterName: "",
        hazardDescription: "위험",
        photoCount: 1,
      }),
    ).toBeNull();
    expect(
      validateWorkStopForm({
        projectId: "p1",
        isAnonymous: false,
        reporterName: "",
        hazardDescription: "위험",
        photoCount: 1,
      }),
    ).toMatch(/보고자명/);
    expect(
      validateWorkStopForm({
        projectId: null,
        isAnonymous: true,
        reporterName: "",
        hazardDescription: "위험",
        photoCount: 1,
      }),
    ).toMatch(/프로젝트/);
  });

  it("requires a scene photo", () => {
    expect(
      validateWorkStopForm({
        projectId: "p1",
        isAnonymous: true,
        reporterName: "",
        hazardDescription: "위험",
        photoCount: 0,
      }),
    ).toMatch(/사진/);
    expect(
      validateWorkStopForm({
        projectId: "p1",
        isAnonymous: true,
        reporterName: "",
        hazardDescription: "위험",
        photoCount: 4,
      }),
    ).toMatch(/최대/);
  });

  it("cites 제52조 and treats 확인중 as open", () => {
    expect(WORK_STOP_LEGAL_CITE).toContain("제52조");
    expect(WORK_STOP_OPEN_STATUSES).toEqual(["접수", "확인중"]);
    expect(isWorkStopOpenStatus("확인중")).toBe(true);
    expect(isWorkStopOpenStatus("검토중")).toBe(false);
  });
});

describe("work-stop photos", () => {
  it("stores one URL as-is and many as JSON", () => {
    expect(serializeWorkStopPhotos([])).toBeNull();
    expect(serializeWorkStopPhotos([" https://x/a.jpg "])).toBe("https://x/a.jpg");
    expect(serializeWorkStopPhotos(["https://x/a.jpg", "https://x/b.jpg"])).toBe(
      JSON.stringify(["https://x/a.jpg", "https://x/b.jpg"]),
    );
    expect(WORK_STOP_MAX_PHOTOS).toBe(3);
  });

  it("reads legacy single URLs and JSON arrays", () => {
    expect(parseWorkStopPhotoUrls(null)).toEqual([]);
    expect(parseWorkStopPhotoUrls("https://x/a.jpg")).toEqual(["https://x/a.jpg"]);
    expect(parseWorkStopPhotoUrls(JSON.stringify(["https://x/a.jpg", "https://x/b.jpg"]))).toEqual([
      "https://x/a.jpg",
      "https://x/b.jpg",
    ]);
    expect(parseWorkStopPhotoUrls("[not-json")).toEqual([]);
  });
});

describe("work-stop home layout", () => {
  it("hides GPS after clock-in and shows the work-stop card", () => {
    expect(shouldShowHomeGpsCard(false)).toBe(true);
    expect(shouldShowHomeGpsCard(true)).toBe(false);
    expect(shouldShowHomeWorkStopCard(false)).toBe(false);
    expect(shouldShowHomeWorkStopCard(true)).toBe(true);
  });
});

describe("work-stop notify recipients", () => {
  const company = "co-1";
  it("notifies same-company managers and 발주처, not workers", () => {
    expect(
      isWorkStopNotifyRecipient(
        { user_id: "u-co-sm", role_new: "safety_manager", company_id: company },
        company,
      ),
    ).toBe(true);
    expect(
      isWorkStopNotifyRecipient(
        { user_id: "u-co-w", role_new: "worker", company_id: company },
        company,
      ),
    ).toBe(false);
    expect(
      isWorkStopNotifyRecipient(
        { user_id: "u-owner", role_new: "project_admin", position_new: "OWNER_SM", company_id: "client" },
        company,
      ),
    ).toBe(true);
    expect(
      isWorkStopNotifyRecipient(
        { user_id: "u-other-co", role_new: "site_supervisor", company_id: "co-2" },
        company,
      ),
    ).toBe(false);
    expect(
      isWorkStopNotifyRecipient(
        { user_id: "u-gc", role_new: "site_manager", company_id: "gc" },
        company,
      ),
    ).toBe(true);
  });
});

describe("work-stop notification routes", () => {
  it("opens the work-stop page from type, related_type, or legacy link", () => {
    expect(
      resolveNotificationRoute({ type: "work_stop" }, { mobileShell: true }),
    ).toBe("/app/worker/work-stop");
    expect(
      resolveNotificationRoute(
        { related_type: "work_stop", related_id: "x" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/work-stop");
    expect(
      resolveNotificationRoute({ type: "work_stop_request", link: "/work-stop" }, { mobileShell: true }),
    ).toBe("/app/worker/work-stop");
  });
});
