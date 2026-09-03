import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { formatLegalCalcPrintHtml } from "../_shared/legalCalcPrint.ts";
import { formatSectionPrintHtml } from "../_shared/formatSectionContent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatKST(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const kst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kst.getUTCDate()).padStart(2, "0");
  const h = String(kst.getUTCHours()).padStart(2, "0");
  const min = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${min}`;
}

const JOB_TITLE_LABELS: Record<string, string> = {
  contractor_supervisor: "관리감독자",
  contractor_pic: "관리감독자",
  contractor_safety_manager: "안전관리자",
  safety_pic: "안전관리자",
  contractor_site_director: "현장소장",
  site_director: "현장소장",
  owner_cm: "발주처 CM",
  owner_sm: "발주처 SM",
  cm: "발주처 CM",
  sm: "발주처 SM",
  supervisor: "관리감독자",
  safety_manager: "안전관리자",
  site_manager: "현장소장",
  site_supervisor: "관리감독자",
  project_admin: "프로젝트 관리자",
};

function jobTitleLabel(pos?: string | null): string {
  const key = String(pos || "").trim();
  if (!key) return "";
  return JOB_TITLE_LABELS[key] || JOB_TITLE_LABELS[key.toLowerCase()] || JOB_TITLE_LABELS[key.toUpperCase()] || key;
}

function localizePersonName(name?: string | null): string {
  const raw = String(name || "").trim();
  return raw.replace(/\s*\/\s*([A-Za-z0-9_]+)\s*$/, (_m, code: string) => {
    const label = jobTitleLabel(code);
    return label ? ` / ${label}` : ` / ${code}`;
  });
}

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseJsonSafe(val: unknown): any {
  if (val == null || val === "") return null;
  if (typeof val === "object") return val;
  if (typeof val !== "string") return null;
  try { return JSON.parse(val); } catch { return null; }
}

function jwtSub(token: string): string | null {
  try {
    const seg = token.split(".")[1];
    if (!seg) return null;
    const pad = "=".repeat((4 - (seg.length % 4)) % 4);
    const json = atob(seg.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";
    // Gateway already verified JWT (verify_jwt). Do not call getUser/getClaims —
    // those hit Auth/JWKS and can stall the worker (546/503), hanging desktop CORS.
    if (!jwtSub(token)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { planId, riskTable } = await req.json();
    const riskTablePayload =
      riskTable && typeof riskTable === "object" && Array.isArray((riskTable as any).headers)
        ? (riskTable as { source?: string; headers: string[]; rows: string[][] })
        : null;

    if (!planId) {
      return new Response(JSON.stringify({ error: "planId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: plan, error: planError } = await userClient
      .from("work_plans").select("*").eq("id", planId).single();
    if (planError || !plan) {
      return new Response(JSON.stringify({ error: "Not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [projectRes, riggingRes, approvalsRes, companyRes, attachmentsRes, draftRes] = await Promise.all([
      supabase.from("projects").select("name, site_name, client, contractor").eq("id", plan.project_id).single(),
      supabase.from("rigging_plans").select("*").eq("work_plan_id", planId).maybeSingle(),
      // SSOT: work_plan approvals live on entity_id. run_id is assessment-only (null here).
      supabase.from("approvals").select("*")
        .eq("entity_type", "work_plan")
        .eq("entity_id", planId)
        .order("approval_version", { ascending: false }),
      plan.company_id ? supabase.from("companies").select("name").eq("id", plan.company_id).single() : Promise.resolve({ data: null }),
      supabase.from("work_plan_attachments")
        .select("id, name, category, attachment_key, file_url, mime_type, description, is_mandatory")
        .eq("work_plan_id", planId)
        .eq("is_deleted", false)
        .order("is_mandatory", { ascending: false })
        .order("created_at", { ascending: true }),
      supabase.from("document_approval_drafts").select("steps, status")
        .eq("entity_type", "work_plan")
        .eq("entity_id", planId)
        .maybeSingle(),
    ]);

    const project = projectRes.data;
    const rigging = riggingRes.data;
    let approvals = approvalsRes.data || [];
    if (approvals.length === 0) {
      const { data: legacy } = await supabase.from("approvals").select("*")
        .eq("run_id", planId)
        .order("approval_version", { ascending: false });
      approvals = legacy || [];
    }
    const companyName = companyRes.data?.name || "";
    const dbAttachments = (attachmentsRes as any).data || [];
    const draftSteps = Array.isArray((draftRes as any)?.data?.steps) ? (draftRes as any).data.steps : [];

    let creatorName = "";
    const authorUserId = plan.author_user_id || plan.created_by;
    if (authorUserId) {
      const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", authorUserId).single();
      creatorName = prof?.display_name || "";
    }

    const sections: any[] = Array.isArray(plan.sections) ? plan.sections : [];
    // SSOT: work_plan_attachments only (legacy JSON ignored for print checklist)
    const attachments: any[] = dbAttachments.map((a: any) => ({
      name: a.name || a.attachment_key || "첨부파일",
      key: a.attachment_key,
      fileUrl: a.file_url,
      mime: a.mime_type,
      uploaded: !!a.file_url,
      mandatory: !!a.is_mandatory,
      category: a.category,
      description: a.description,
    }));


    const latestVersion = approvals.length > 0 ? Math.max(...approvals.map((a: any) => Number(a.approval_version) || 1)) : 0;
    const latestApprovals = approvals
      .filter((a: any) => (Number((a as any).approval_version) || 1) === latestVersion && a.status !== "취소")
      .sort((a: any, b: any) => (a.step_order ?? 99) - (b.step_order ?? 99));

    let sigRowsHtml = "";
    if (latestApprovals.length > 0) {
      for (const ap of latestApprovals) {
        const posLabel = jobTitleLabel((ap as any).position);
        const dateStr = ap.status === "승인" && ap.approved_at ? formatKST(ap.approved_at) : (ap.status === "반려" ? "반려" : (ap.status === "진행중" ? "진행중" : "대기"));
        sigRowsHtml += `<tr>
          <td class="sig-role">${escapeHtml(ap.step || "")}</td>
          <td>${escapeHtml(localizePersonName(ap.approver_name || ""))}</td>
          <td>${escapeHtml((ap as any).company_name || "")}</td>
          <td>${escapeHtml(posLabel)}</td>
          <td class="sig-stamp">${dateStr}</td>
        </tr>`;
      }
    } else if (draftSteps.length > 0) {
      for (const s of draftSteps) {
        sigRowsHtml += `<tr>
          <td class="sig-role">${escapeHtml(s.label || s.step_label || "")}</td>
          <td>${escapeHtml(localizePersonName(s.user_name || ""))}</td>
          <td>${escapeHtml(s.company_name || "")}</td>
          <td>${escapeHtml(jobTitleLabel(s.position))}</td>
          <td class="sig-stamp"></td>
        </tr>`;
      }
    } else {
      sigRowsHtml = `<tr><td colspan="5" class="center" style="color:#64748b">결재 기록이 없습니다</td></tr>`;
    }

    function renderSection(section: any): string {
      const data = parseJsonSafe(section.content);
      if (!data && !section.content) return "";

      if (section.key === "overview" && data) {
        return `<table class="info-table"><tbody>
          <tr><td class="label">작업명</td><td>${escapeHtml(data.work_name || "")}</td><td class="label">작업일시</td><td>${escapeHtml(data.work_date || "")}</td></tr>
          <tr><td class="label">작업위치</td><td>${escapeHtml(data.work_location || "")}</td><td class="label">현장감독자</td><td>${escapeHtml(data.supervisor || "")}</td></tr>
          <tr><td class="label">투입인원</td><td>${escapeHtml(data.workers_count || "")}</td><td class="label"></td><td></td></tr>
          <tr><td class="label">작업내용</td><td colspan="3">${escapeHtml(data.work_content || "")}</td></tr>
        </tbody></table>`;
      }

      if (section.key === "method") {
        let steps: any[] = [];
        let notes = "";
        if (Array.isArray(data)) {
          steps = data;
        } else if (data && typeof data === "object") {
          notes = typeof data.notes === "string" ? data.notes : "";
          const keys = Object.keys(data)
            .filter((k) => k !== "notes" && /^\d+$/.test(k))
            .sort((a, b) => Number(a) - Number(b));
          if (keys.length) {
            steps = keys.map((k) => data[k]);
          } else if (Array.isArray(data.steps)) {
            steps = data.steps;
          }
        }
        if (notes.trim()) {
          steps = [
            ...steps,
            { order: steps.length + 1, description: "법규·계산 참고", safety_measure: notes.trim() },
          ];
        }
        if (steps.length) {
          const rows = steps.map((s: any) =>
            `<tr><td class="center" style="width:40px">${s.order || ""}</td><td>${escapeHtml(s.description || "")}</td><td>${escapeHtml(s.safety_measure || "")}</td></tr>`
          ).join("");
          return `<table><thead><tr><th>순서</th><th>작업 단계</th><th>안전조치</th></tr></thead><tbody>${rows}</tbody></table>`;
        }
      }

      if (section.key === "equipment" && Array.isArray(data)) {
        const rows = data.map((e: any) =>
          `<tr><td>${escapeHtml(e.name || "")}</td><td>${escapeHtml(e.model || "")}</td><td>${escapeHtml(e.capacity || "")}</td><td>${escapeHtml(e.manufacturer || "")}</td><td>${escapeHtml(e.inspection_date || "")}</td></tr>`
        ).join("");
        return `<table><thead><tr><th>장비명</th><th>모델명</th><th>정격하중(t)</th><th>제조사</th><th>검사일</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      if (section.key === "risk" && Array.isArray(data)) {
        const rows = data.map((r: any) =>
          `<tr><td>${escapeHtml(r.hazard || "")}</td><td>${escapeHtml(r.situation || "")}</td><td>${escapeHtml(r.measure || "")}</td><td class="center">${escapeHtml(r.severity || "")}</td></tr>`
        ).join("");
        return `<table><thead><tr><th>위험요인</th><th>발생상황</th><th>안전대책</th><th>위험도</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      if (section.key === "signal" && data) {
        return `<table class="info-table"><tbody>
          <tr><td class="label">신호수</td><td>${escapeHtml(data.signal_person || "")}</td><td class="label">신호방법</td><td>${escapeHtml(data.signal_method || "")}</td></tr>
          <tr><td class="label">무전채널</td><td>${escapeHtml(data.radio_channel || "")}</td><td class="label">비상신호</td><td>${escapeHtml(data.emergency_signal || "")}</td></tr>
          <tr><td class="label">수신호</td><td colspan="3">${escapeHtml(data.hand_signals || "")}</td></tr>
        </tbody></table>`;
      }

      if (section.key === "emergency" && data) {
        return `<table class="info-table"><tbody>
          <tr><td class="label">비상연락</td><td>${escapeHtml(data.emergency_contact || "")}</td><td class="label">인근병원</td><td>${escapeHtml(data.hospital || "")}</td></tr>
          <tr><td class="label">대피경로</td><td>${escapeHtml(data.evacuation_route || "")}</td><td class="label">집결장소</td><td>${escapeHtml(data.assembly_point || "")}</td></tr>
          <tr><td class="label">응급처치</td><td colspan="3">${escapeHtml(data.first_aid || "")}</td></tr>
          <tr><td class="label">보고체계</td><td colspan="3">${escapeHtml(data.reporting_procedure || "")}</td></tr>
        </tbody></table>`;
      }

      if (section.key === "_legal_calc" || section.type === "calc") {
        return formatLegalCalcPrintHtml(section.content, escapeHtml);
      }

      // Structured forms (geology/shoring/contact/…) are JSON. Never dump the raw string.
      return formatSectionPrintHtml(data ?? section.content, escapeHtml, section.key);
    }

    const filteredSections = sections.filter(s => s.key !== "_checklist" && s.key !== "rigging");
    const overviewSection = filteredSections.find(s => s.key === "overview");
    const basicInfoHtml = overviewSection ? renderSection(overviewSection) : "";

    const methodSection = filteredSections.find(s => s.key === "method");
    const equipSection = filteredSections.find(s => s.key === "equipment");
    let page2Html = "";
    if (methodSection) {
      page2Html += `<div class="section-header">작업 방법 및 절차</div>${renderSection(methodSection)}`;
    }
    if (equipSection) {
      page2Html += `<div class="section-header" style="margin-top:10pt;">장비 정보</div>${renderSection(equipSection)}`;
    }

    const riskSection = filteredSections.find(s => s.key === "risk");
    let page3Html = "";
    if (riskTablePayload && Array.isArray(riskTablePayload.rows) && riskTablePayload.headers?.length) {
      const head = riskTablePayload.headers
        .map((h) => `<th>${escapeHtml(String(h || ""))}</th>`)
        .join("");
      const body = riskTablePayload.rows
        .map((row) => {
          const cells = (Array.isArray(row) ? row : []).map(
            (c) => `<td>${escapeHtml(String(c ?? ""))}</td>`,
          );
          while (cells.length < riskTablePayload.headers.length) cells.push("<td></td>");
          return `<tr>${cells.slice(0, riskTablePayload.headers.length).join("")}</tr>`;
        })
        .join("");
      const srcNote =
        riskTablePayload.source === "excel"
          ? `<p style="font-size:7.5pt;color:#64748b;margin:0 0 6pt;">출처: 업로드된 위험성평가서(엑셀)</p>`
          : "";
      page3Html = `<div class="section-header">위험성평가</div>${srcNote}<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${riskTablePayload.headers.length}" class="center">데이터 없음</td></tr>`}</tbody></table>`;
    } else if (riskSection) {
      page3Html = `<div class="section-header">위험요인 및 안전대책</div>${renderSection(riskSection)}`;
    }

    const otherSections = filteredSections.filter(s => !["overview", "method", "equipment", "risk"].includes(s.key));
    let otherSectionsHtml = otherSections.map(s =>
      `<div class="section-header">${escapeHtml(s.title)}</div>${renderSection(s)}`
    ).join("");

    let riggingHtml = "";
    if (rigging) {
      const sf = Number(rigging.safety_factor) || 0;
      const util = Number(rigging.calculated_utilization) || 0;
      const sfColor = sf < 1.0 ? "#dc2626" : sf < 1.25 ? "#d97706" : "#16a34a";
      const sfLabel = sf < 1.0 ? "🚫 작업금지" : sf < 1.25 ? "⚠️ 경고" : "✅ 안전";
      riggingHtml = `
        <div class="section-header">리깅플랜 (양중계획)</div>
        <table class="info-table"><tbody>
          <tr><td class="label">인양물 중량</td><td>${rigging.load_weight || ""}t</td><td class="label">인양물 설명</td><td>${escapeHtml(rigging.load_description || "")}</td></tr>
          <tr><td class="label">크레인 기종</td><td>${escapeHtml(rigging.crane_model || rigging.equipment_name || "")}</td><td class="label">정격하중</td><td>${rigging.crane_capacity || rigging.rated_capacity || ""}t</td></tr>
          <tr><td class="label">작업 반경</td><td>${rigging.working_radius || ""}m</td><td class="label">붐 길이</td><td>${rigging.boom_length || ""}m</td></tr>
          <tr><td class="label">슬링 종류</td><td>${escapeHtml(rigging.sling_type || rigging.sling_material_type || "")}</td><td class="label">인양 방식</td><td>${escapeHtml(rigging.lifting_method || "")}</td></tr>
          <tr><td class="label">슬링 각도</td><td>${rigging.sling_angle_deg || ""}°</td><td class="label">슬링 본수</td><td>${rigging.sling_count || ""}</td></tr>
          <tr><td class="label">와이어 직경</td><td>${rigging.wire_diameter_mm || ""}mm</td><td class="label">샤클</td><td>${escapeHtml(String(rigging.shackle_inch || rigging.shackle_diameter_mm || ""))}</td></tr>
          <tr><td class="label">지반 지지력</td><td>${rigging.ground_bearing_capacity || ""} t/㎡</td><td class="label">아우트리거</td><td>${escapeHtml(rigging.outrigger_setup || "")}</td></tr>
          <tr><td class="label">풍속 등급</td><td>${escapeHtml(rigging.wind_speed_grade || "")}</td><td class="label">풍속 계수</td><td>${rigging.wind_speed_factor || ""}</td></tr>
        </tbody></table>
        <div style="margin-top:8pt;padding:8pt;border:2pt solid ${sfColor};border-radius:4pt;text-align:center;">
          <span style="font-size:12pt;font-weight:700;color:${sfColor};">${sfLabel} — 안전율: ${sf.toFixed(2)} | 가동률: ${util.toFixed(1)}%</span>
        </div>
        ${rigging.equipment_ok || rigging.sling_ok || rigging.shackle_ok ? `
        <table class="info-table" style="margin-top:8pt;"><tbody>
          <tr><td class="label">장비 판정</td><td>${escapeHtml(rigging.equipment_ok || "")}</td><td class="label">슬링 판정</td><td>${escapeHtml(rigging.sling_ok || "")}</td></tr>
          <tr><td class="label">샤클 판정</td><td colspan="3">${escapeHtml(rigging.shackle_ok || "")}</td></tr>
        </tbody></table>` : ""}
        ${rigging.notes ? `<p style="font-size:8pt;margin-top:6pt;color:#475569;">비고: ${escapeHtml(rigging.notes)}</p>` : ""}`;
    }

    const checklistSection = sections.find(s => s.key === "_checklist");
    let checklistHtml = "";
    if (checklistSection?.content) {
      const items = parseJsonSafe(checklistSection.content);
      if (Array.isArray(items)) {
        const rows = items.map((c: any) =>
          `<tr><td class="center" style="width:30px">${c.checked ? "☑" : "☐"}</td><td>${escapeHtml(c.label || c.item || "")}</td></tr>`
        ).join("");
        checklistHtml = `<div class="section-header">안전 체크리스트</div>
          <table><thead><tr><th></th><th>점검 항목</th></tr></thead><tbody>${rows}</tbody></table>
          <div style="margin-top:40pt;border-top:1px solid #1e293b;padding-top:8pt;">
            <div style="display:flex;justify-content:space-around;">
              <div style="text-align:center;width:30%"><div style="height:60px;border-bottom:1px solid #1e293b;"></div><div style="font-size:8pt;margin-top:4pt;">작성자 서명</div></div>
              <div style="text-align:center;width:30%"><div style="height:60px;border-bottom:1px solid #1e293b;"></div><div style="font-size:8pt;margin-top:4pt;">안전관리자 서명</div></div>
              <div style="text-align:center;width:30%"><div style="height:60px;border-bottom:1px solid #1e293b;"></div><div style="font-size:8pt;margin-top:4pt;">현장대리인 서명</div></div>
            </div>
          </div>`;
      }
    }

    let attachmentsHtml = "";
    const uploadedAttachments = attachments.filter((a: any) => a.uploaded && a.fileUrl);
    const missingMandatory = attachments.filter((a: any) => a.mandatory && !a.uploaded);
    if (attachments.length > 0) {
      const catLabel = (c: string) =>
        c === "legal" ? "법정필수" : c === "calc_evidence" ? "계산근거" : c === "site_proof" ? "현장증빙" : (c || "-");
      attachmentsHtml += `<div class="page-break"></div>
        <div class="section-header">첨부서류 일람 (전체 ${attachments.length}건 · 첨부 ${uploadedAttachments.length} · 필수 미첨부 ${missingMandatory.length})</div>
        <table><thead><tr><th style="width:30pt">No</th><th>구분</th><th>서류명</th><th>상태</th><th>비고</th></tr></thead><tbody>
        ${attachments.map((a: any, i: number) => `
          <tr>
            <td class="center">${i + 1}</td>
            <td>${escapeHtml(catLabel(a.category))}${a.mandatory ? " ★" : ""}</td>
            <td>${escapeHtml(a.name || a.key || "")}</td>
            <td class="center" style="color:${a.uploaded ? "#16a34a" : (a.mandatory ? "#dc2626" : "#64748b")};">${a.uploaded ? "첨부완료" : (a.mandatory ? "미첨부(필수)" : "미첨부")}</td>
            <td style="font-size:7pt;color:#64748b;">${escapeHtml(a.description || "")}</td>
          </tr>`).join("")}
        </tbody></table>
        <p style="font-size:7.5pt;color:#64748b;margin-top:6pt;">★ = 필수 첨부. 첨부는 미리보기·인쇄 2단계·PDF 저장에서 원본으로 이어집니다.</p>`;
    }



    const WORK_TYPE_NAMES: Record<string, string> = {
      heavy_lifting: "중량물 취급 작업 (크레인 등)",
      excavation: "굴착 작업",
      tunnel: "터널 및 지하 작업",
      high_work: "고소 작업",
      scaffold: "비계 작업",
      formwork: "거푸집 및 동바리",
      steel: "철골 작업",
      demolition: "해체 작업",
      explosives: "폭발물 사용 작업",
      confined_space: "밀폐공간 작업",
      other_hazardous: "기타 위험 작업",
    };

    const workTypeName = WORK_TYPE_NAMES[plan.work_type] || plan.work_type;

    const docTitle = `${plan.title || "작업계획서"}`;
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(docTitle)}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; font-size: 9pt; color: #1e293b; line-height: 1.5; }
@page { size: A4 portrait; margin: 10mm; }
.page-break { page-break-before: always; }

.report-header {
  border: 2px solid #1e293b;
  margin-bottom: 12pt;
}
.report-title {
  background: #1e293b;
  color: white;
  text-align: center;
  padding: 10pt 0;
  font-size: 18pt;
  font-weight: 700;
  letter-spacing: 3pt;
}
.report-subtitle {
  text-align: center;
  padding: 4pt 0;
  font-size: 10pt;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}

.sig-table { width: 100%; border-collapse: collapse; margin-bottom: 12pt; }
.sig-table th, .sig-table td { border: 1px solid #cbd5e1; padding: 4pt 6pt; font-size: 8pt; text-align: center; }
.sig-table th { background: #f1f5f9; font-weight: 600; font-size: 7pt; color: #475569; }
.sig-role { font-weight: 600; background: #f8fafc; white-space: nowrap; }
.sig-stamp { font-size: 7pt; color: #64748b; }

.info-table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; }
.info-table td { border: 1px solid #e2e8f0; padding: 4pt 8pt; font-size: 8pt; }
.info-table .label { background: #f1f5f9; font-weight: 600; width: 80pt; white-space: nowrap; color: #334155; }

.report-info { display: table; width: 100%; border-collapse: collapse; }
.report-info-row { display: table-row; }
.report-info-label { display: table-cell; background: #f1f5f9; font-weight: 600; font-size: 8pt; padding: 4pt 8pt; border: 1px solid #e2e8f0; width: 80pt; white-space: nowrap; color: #334155; }
.report-info-value { display: table-cell; font-size: 8pt; padding: 4pt 8pt; border: 1px solid #e2e8f0; color: #1e293b; }

.section-header {
  font-size: 11pt;
  font-weight: 700;
  margin: 12pt 0 6pt;
  padding: 4pt 8pt;
  background: #f1f5f9;
  border-left: 4pt solid #1e293b;
}

table { width: 100%; border-collapse: collapse; margin-bottom: 8pt; font-size: 8pt; }
th, td { border: 1px solid #cbd5e1; padding: 3pt 5pt; }
th { background: #f1f5f9; font-weight: 600; font-size: 7pt; text-align: center; color: #475569; }
.center { text-align: center; }

.text-block {
  font-size: 9pt;
  padding: 6pt;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}

.footer {
  width: 100%;
  text-align: center;
  font-size: 7pt;
  color: #94a3b8;
  padding: 8pt 0 0;
  margin-top: 12pt;
}
@media print {
  html, body {
    width: auto !important;
    min-width: 0 !important;
  }
  .footer { display: none; }
}
</style>
</head>
<body>

<div class="report-header">
  <div class="report-title">작 업 계 획 서</div>
  <div class="report-subtitle">${escapeHtml(plan.title)}</div>
  <div class="report-info">
    <div class="report-info-row">
      <div class="report-info-label">현장명</div>
      <div class="report-info-value">${escapeHtml(project?.site_name || "")}</div>
      <div class="report-info-label">프로젝트</div>
      <div class="report-info-value">${escapeHtml(project?.name || "")}</div>
    </div>
    <div class="report-info-row">
      <div class="report-info-label">공종</div>
      <div class="report-info-value">${escapeHtml(workTypeName)}</div>
      <div class="report-info-label">작업기간</div>
      <div class="report-info-value">${plan.start_date || ""} ~ ${plan.end_date || ""}</div>
    </div>
    <div class="report-info-row">
      <div class="report-info-label">소속업체</div>
      <div class="report-info-value">${escapeHtml(companyName)}</div>
      <div class="report-info-label">작성 관리감독자</div>
      <div class="report-info-value">${escapeHtml(creatorName)}</div>
    </div>
    <div class="report-info-row">
      <div class="report-info-label">회차</div>
      <div class="report-info-value">v${plan.version || 1}</div>
      <div class="report-info-label">상태</div>
      <div class="report-info-value">${escapeHtml(plan.status)}</div>
    </div>
  </div>
</div>

<table class="sig-table">
  <thead><tr><th>단계</th><th>성명</th><th>소속</th><th>직책</th><th>서명/일시</th></tr></thead>
  <tbody>${sigRowsHtml}</tbody>
</table>

${basicInfoHtml ? `<div class="section-header">작업 개요</div>${basicInfoHtml}` : ""}

${page2Html ? `<div class="page-break"></div>${page2Html}` : ""}

${riggingHtml ? `${page2Html ? "" : '<div class="page-break"></div>'}${riggingHtml}` : ""}

${page3Html ? `<div class="page-break"></div>${page3Html}` : ""}

${otherSectionsHtml ? `${otherSectionsHtml}` : ""}

${checklistHtml ? `<div class="page-break"></div>${checklistHtml}` : ""}

${attachmentsHtml}

<div class="footer">본 문서는 산업안전보건법에 의거하여 작성된 작업계획서입니다. | 출력일: ${formatKST(new Date().toISOString())}</div>

</body>
</html>`;

    const fileName = `${docTitle}_${formatKST(new Date().toISOString()).slice(0,10)}.pdf`;
    return new Response(JSON.stringify({ html, title: docTitle, fileName }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-workplan-pdf error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
