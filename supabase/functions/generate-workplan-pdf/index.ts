import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    return `data:${ct};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

const POSITION_LABELS: Record<string, string> = {
  supervisor: "관리감독자",
  safety_manager: "안전관리자",
  site_manager: "현장대리인",
  project_admin: "프로젝트 관리자",
};

function escapeHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function parseJsonSafe(val: string): any {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
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

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { planId } = await req.json();
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

    const [projectRes, riggingRes, approvalsRes, companyRes, attachmentsRes] = await Promise.all([
      supabase.from("projects").select("name, site_name, client, contractor").eq("id", plan.project_id).single(),
      supabase.from("rigging_plans").select("*").eq("work_plan_id", planId).maybeSingle(),
      supabase.from("approvals").select("*").eq("run_id", planId).order("approval_version", { ascending: false }),
      plan.company_id ? supabase.from("companies").select("name").eq("id", plan.company_id).single() : Promise.resolve({ data: null }),
      supabase.from("work_plan_attachments")
        .select("id, name, category, attachment_key, file_url, mime_type, description")
        .eq("work_plan_id", planId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: true }),
    ]);

    const project = projectRes.data;
    const rigging = riggingRes.data;
    const approvals = approvalsRes.data || [];
    const companyName = companyRes.data?.name || "";
    const dbAttachments = (attachmentsRes as any).data || [];

    let creatorName = "";
    if (plan.created_by) {
      const { data: prof } = await supabase.from("profiles").select("display_name").eq("user_id", plan.created_by).single();
      creatorName = prof?.display_name || "";
    }

    const sections: any[] = Array.isArray(plan.sections) ? plan.sections : [];
    const legacyAttachments: any[] = Array.isArray(plan.attachments) ? plan.attachments : [];
    // Merge: prefer DB rows; keep legacy JSON entries that aren't already represented
    const attachments: any[] = [
      ...dbAttachments.map((a: any) => ({
        name: a.name || a.attachment_key || "첨부파일",
        key: a.attachment_key,
        fileUrl: a.file_url,
        mime: a.mime_type,
        uploaded: !!a.file_url,
        description: a.description,
      })),
      ...legacyAttachments.filter((a: any) => a.uploaded && a.fileUrl &&
        !dbAttachments.some((d: any) => d.file_url === a.fileUrl)),
    ];


    const STEP_ORDER: Record<string, number> = { '작성': 0, '안전관리자 검토': 1, '현장대리인 확인': 2, '최종승인': 3 };
    const latestVersion = approvals.length > 0 ? (approvals[0] as any).approval_version || 1 : 0;
    const latestApprovals = approvals.filter((a: any) => ((a as any).approval_version || 1) === latestVersion && a.status !== '취소');
    latestApprovals.sort((a: any, b: any) => (STEP_ORDER[a.step] ?? 99) - (STEP_ORDER[b.step] ?? 99));

    let sigRowsHtml = "";
    if (latestApprovals.length > 0) {
      for (const ap of latestApprovals) {
        const posLabel = POSITION_LABELS[(ap as any).position] || (ap as any).position || "";
        const dateStr = ap.status === "승인" && ap.approved_at ? formatKST(ap.approved_at) : (ap.status === "반려" ? "반려" : "대기");
        sigRowsHtml += `<tr>
          <td class="sig-role">${escapeHtml(ap.step)}</td>
          <td>${escapeHtml(ap.approver_name || "")}</td>
          <td>${escapeHtml((ap as any).company_name || "")}</td>
          <td>${escapeHtml(posLabel)}</td>
          <td class="sig-stamp">${dateStr}</td>
        </tr>`;
      }
    } else {
      sigRowsHtml = `
        <tr><td class="sig-role">작성</td><td>${escapeHtml(creatorName)}</td><td>${escapeHtml(companyName)}</td><td></td><td class="sig-stamp">${formatKST(plan.created_at)}</td></tr>
        <tr><td class="sig-role">안전관리자</td><td></td><td></td><td></td><td class="sig-stamp"></td></tr>
        <tr><td class="sig-role">현장대리인</td><td></td><td></td><td></td><td class="sig-stamp"></td></tr>
        <tr><td class="sig-role">최종승인</td><td></td><td></td><td></td><td class="sig-stamp"></td></tr>`;
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

      if (section.key === "method" && Array.isArray(data)) {
        const rows = data.map((s: any) =>
          `<tr><td class="center" style="width:40px">${s.order || ""}</td><td>${escapeHtml(s.description || "")}</td><td>${escapeHtml(s.safety_measure || "")}</td></tr>`
        ).join("");
        return `<table><thead><tr><th>순서</th><th>작업 단계</th><th>안전조치</th></tr></thead><tbody>${rows}</tbody></table>`;
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

      if (typeof section.content === "string" && section.content.trim()) {
        return `<div class="text-block">${escapeHtml(section.content)}</div>`;
      }
      if (data && typeof data === "object") {
        const rows = Object.entries(data).map(([k, v]) =>
          `<tr><td class="label">${escapeHtml(k)}</td><td>${escapeHtml(String(v || ""))}</td></tr>`
        ).join("");
        return `<table class="info-table"><tbody>${rows}</tbody></table>`;
      }
      return "";
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
    if (riskSection) {
      page3Html = `<div class="section-header">위험요인 및 안전대책</div>${renderSection(riskSection)}`;
    }

    const otherSections = filteredSections.filter(s => !["overview", "method", "equipment", "risk"].includes(s.key));
    let otherSectionsHtml = otherSections.map(s =>
      `<div class="section-header">${escapeHtml(s.title)}</div>${renderSection(s)}`
    ).join("");

    let riggingHtml = "";
    if (rigging) {
      const sf = rigging.safety_factor || 0;
      const sfColor = sf < 1.0 ? "#dc2626" : sf < 1.25 ? "#d97706" : "#16a34a";
      const sfLabel = sf < 1.0 ? "🚫 작업금지" : sf < 1.25 ? "⚠️ 경고" : "✅ 안전";
      riggingHtml = `
        <div class="section-header">리깅플랜 (양중계획)</div>
        <table class="info-table"><tbody>
          <tr><td class="label">인양물 중량</td><td>${rigging.load_weight || ""}t</td><td class="label">인양물 설명</td><td>${escapeHtml(rigging.load_description || "")}</td></tr>
          <tr><td class="label">크레인 기종</td><td>${escapeHtml(rigging.crane_model || "")}</td><td class="label">정격하중</td><td>${rigging.crane_capacity || ""}t</td></tr>
          <tr><td class="label">작업 반경</td><td>${rigging.working_radius || ""}m</td><td class="label">붐 길이</td><td>${rigging.boom_length || ""}m</td></tr>
          <tr><td class="label">슬링 종류</td><td>${escapeHtml(rigging.sling_type || "")}</td><td class="label">인양 방식</td><td>${escapeHtml(rigging.lifting_method || "")}</td></tr>
          <tr><td class="label">지반 지지력</td><td>${rigging.ground_bearing_capacity || ""} t/㎡</td><td class="label">아우트리거</td><td>${escapeHtml(rigging.outrigger_setup || "")}</td></tr>
        </tbody></table>
        <div style="margin-top:8pt;padding:8pt;border:2pt solid ${sfColor};border-radius:4pt;text-align:center;">
          <span style="font-size:12pt;font-weight:700;color:${sfColor};">${sfLabel} — 안전율: ${sf.toFixed(2)} | 가동률: ${(rigging.calculated_utilization || 0).toFixed(1)}%</span>
        </div>`;
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
    for (const att of uploadedAttachments) {
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(att.fileUrl || "");
      if (isImage) {
        const b64 = await imageUrlToBase64(att.fileUrl);
        if (b64) {
          attachmentsHtml += `<div class="page-break"></div>
            <div class="section-header">${escapeHtml(att.name || att.key || "첨부파일")}</div>
            <div style="text-align:center;padding:10pt;">
              <img src="${b64}" style="max-width:90%;max-height:700pt;object-fit:contain;" />
            </div>`;
        }
      } else {
        attachmentsHtml += `<div class="page-break"></div>
          <div class="section-header">${escapeHtml(att.name || att.key || "첨부파일")}</div>
          <div style="text-align:center;padding:40pt;color:#475569;">
            <p>파일: ${escapeHtml(att.fileUrl?.split("/").pop() || "")}</p>
            <p style="font-size:8pt;margin-top:8pt;">이미지가 아닌 파일은 별도로 확인해주세요.</p>
          </div>`;
      }
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

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; font-size: 9pt; color: #1e293b; line-height: 1.5; }
@page { size: A4 portrait; margin: 15mm; }
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
  position: fixed;
  bottom: 0;
  width: 100%;
  text-align: center;
  font-size: 7pt;
  color: #94a3b8;
  padding: 4pt 0;
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
      <div class="report-info-label">작성자</div>
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

    return new Response(JSON.stringify({ html, title: plan.title }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-workplan-pdf error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
