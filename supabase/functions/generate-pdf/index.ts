import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "image/jpeg";
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return `data:${ct};base64,${b64}`;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { runId, type } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: run, error: runError } = await userClient
      .from("assessment_runs").select("*").eq("id", runId).single();
    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const [projectRes, itemsRes, participantsRes, feedbackRes, validationRes, approvalsRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", run.project_id).single(),
      supabase.from("risk_items").select("*").eq("run_id", runId).order("sort_order"),
      supabase.from("assessment_run_participants").select("*").eq("run_id", runId),
      supabase.from("risk_item_feedback").select("*").eq("assessment_run_id", runId),
      type === "validation"
        ? supabase.from("validation_results").select("*").eq("run_id", runId)
        : Promise.resolve({ data: [] }),
      supabase.from("approvals").select("*").eq("run_id", runId).order("approval_version", { ascending: false }),
    ]);

    const project = projectRes.data;
    const items = itemsRes.data || [];
    const participants = participantsRes.data || [];
    const feedbackItems = feedbackRes.data || [];
    const validationResults = (validationRes as any).data || [];
    const approvals = approvalsRes.data || [];

    // Fetch creator profile for signature auto-fill
    let creatorName = "";
    let creatorCompany = "";
    if (run.created_by) {
      const { data: creatorProfile } = await supabase.from("profiles").select("display_name, company").eq("user_id", run.created_by).single();
      if (creatorProfile) {
        creatorName = creatorProfile.display_name || "";
        creatorCompany = creatorProfile.company || "";
      }
      const { data: creatorMember } = await supabase.from("project_members").select("company").eq("user_id", run.created_by).eq("project_id", run.project_id).single();
      if (creatorMember?.company) creatorCompany = creatorMember.company;
    }

    // Build auto-filled signature data from approvals
    const latestVersion = approvals.length > 0 ? approvals[0].approval_version || 1 : 0;
    const latestApprovals = approvals.filter((a: any) => (a.approval_version || 1) === latestVersion);
    
    const reviewerApproval = latestApprovals.find((a: any) => a.step === '검토자' && a.status === '승인')
      || latestApprovals.find((a: any) => a.step === '검토' && a.status === '승인');
    const approverApproval = latestApprovals.find((a: any) => a.step === '승인자' && a.status === '승인')
      || latestApprovals.find((a: any) => a.step === '승인' && a.status === '승인');

    const sigRoles = [
      { role: "작성자", name: creatorName, company: creatorCompany, date: run.created_at ? new Date(run.created_at).toLocaleDateString("ko-KR") : "" },
      { role: "검토자", name: reviewerApproval?.approver_name || "", company: "", date: reviewerApproval?.updated_at ? new Date(reviewerApproval.updated_at).toLocaleDateString("ko-KR") : "" },
      { role: "승인자", name: approverApproval?.approver_name || "", company: "", date: approverApproval?.updated_at ? new Date(approverApproval.updated_at).toLocaleDateString("ko-KR") : "" },
    ];

    for (const sig of sigRoles) {
      if (sig.role === "검토자" && reviewerApproval?.approver_id) {
        const { data: p } = await supabase.from("project_members").select("company").eq("user_id", reviewerApproval.approver_id).eq("project_id", run.project_id).single();
        if (p?.company) sig.company = p.company;
      }
      if (sig.role === "승인자" && approverApproval?.approver_id) {
        const { data: p } = await supabase.from("project_members").select("company").eq("user_id", approverApproval.approver_id).eq("project_id", run.project_id).single();
        if (p?.company) sig.company = p.company;
      }
    }

    const sigRows = sigRoles.map(s =>
      `<tr><td class="sig-role">${s.role}</td><td>${s.name}</td><td>${s.company}</td><td class="sig-stamp">${s.date}</td></tr>`
    ).join("");

    // Convert feedback images to base64
    const feedbackWithImages = await Promise.all(
      feedbackItems.map(async (fb: any) => {
        const beforeImages: string[] = [];
        const afterImages: string[] = [];
        for (const url of (fb.before_image_urls || []).slice(0, 3)) {
          const b64 = await imageUrlToBase64(url);
          if (b64) beforeImages.push(b64);
        }
        if (fb.status === "완료") {
          for (const url of (fb.after_image_urls || []).slice(0, 3)) {
            const b64 = await imageUrlToBase64(url);
            if (b64) afterImages.push(b64);
          }
        }
        return { ...fb, beforeBase64: beforeImages, afterBase64: afterImages };
      })
    );

    // Convert worker participation images to base64
    const workerImages: string[] = [];
    for (const url of (run.worker_participation_images || []).slice(0, 6)) {
      const b64 = await imageUrlToBase64(url);
      if (b64) workerImages.push(b64);
    }

    const gradeColor = (g: string) =>
      g === "상" ? "#dc2626" : g === "중" ? "#d97706" : "#16a34a";
    const gradeBg = (g: string) =>
      g === "상" ? "#fecaca" : g === "중" ? "#fef08a" : "#bbf7d0";

    const today = new Date().toISOString().slice(0, 10);
    const runPeriod = run.start_date && run.end_date
      ? `${run.start_date} ~ ${run.end_date}`
      : `${project?.period_start || ""} ~ ${project?.period_end || ""}`;

    const highCount = items.filter((i: any) => i.risk_grade === "상").length;
    const medCount = items.filter((i: any) => i.risk_grade === "중").length;
    const lowCount = items.filter((i: any) => i.risk_grade === "하").length;

    // Risk items table — includes legal_basis column
    const itemRows = items.map((item: any, i: number) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td class="nowrap">${item.process || ""}</td>
        <td>${item.sub_task || ""}</td>
        <td>${item.hazard || ""}</td>
        <td>${item.hazard_situation || ""}</td>
        <td>${item.existing_measure || ""}</td>
        <td>${item.improvement_measure || ""}</td>
        <td class="center grade" style="background:${gradeBg(item.likelihood_grade)};color:${gradeColor(item.likelihood_grade)}">${item.likelihood_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.severity_grade)};color:${gradeColor(item.severity_grade)}">${item.severity_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.risk_grade)};color:${gradeColor(item.risk_grade)};font-weight:bold">${item.risk_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_likelihood_grade)};color:${gradeColor(item.improved_likelihood_grade)}">${item.improved_likelihood_grade || "하"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_severity_grade)};color:${gradeColor(item.improved_severity_grade)}">${item.improved_severity_grade || "하"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_risk_grade)};color:${gradeColor(item.improved_risk_grade)};font-weight:bold">${item.improved_risk_grade || "하"}</td>
        <td class="center">${item.status || ""}</td>
        <td>${(item.ppe || []).join(", ")}</td>
        <td style="font-size:7pt;">${(item.legal_basis || []).join(", ")}</td>
        <td>${item.department || ""}</td>
        <td>${item.assignee || ""}</td>
      </tr>`).join("");

    // Feedback section with photos
    let feedbackSection = "";
    if (feedbackWithImages.length > 0) {
      const fbRows = feedbackWithImages.map((fb: any, idx: number) => {
        const item = items.find((i: any) => i.id === fb.risk_item_id);
        const itemLabel = item ? `${item.process} – ${item.sub_task || ""}` : "(전체)";
        const statusColor = fb.status === "완료" ? "#16a34a" : fb.status === "진행중" ? "#d97706" : "#dc2626";
        const showAfter = fb.status === "완료";

        let imagesHtml = "";
        if (fb.beforeBase64.length > 0 || (showAfter && fb.afterBase64.length > 0)) {
          imagesHtml = `<tr><td colspan="5" style="padding:6pt;">
            <table style="width:100%;border:none;"><tr>
              <td style="border:none;width:50%;vertical-align:top;">
                <div style="font-size:7pt;font-weight:600;margin-bottom:3pt;color:#475569;">▸ 조치 전 (Before)</div>
                ${fb.beforeBase64.length > 0
                  ? fb.beforeBase64.map((b64: string) => `<img src="${b64}" style="max-width:180pt;max-height:120pt;border:1px solid #cbd5e1;border-radius:3pt;margin-right:4pt;page-break-inside:avoid;" />`).join("")
                  : '<span style="font-size:7pt;color:#94a3b8;">사진 없음</span>'}
              </td>
              ${showAfter ? `<td style="border:none;width:50%;vertical-align:top;">
                <div style="font-size:7pt;font-weight:600;margin-bottom:3pt;color:#475569;">▸ 조치 후 (After)</div>
                ${fb.afterBase64.length > 0
                  ? fb.afterBase64.map((b64: string) => `<img src="${b64}" style="max-width:180pt;max-height:120pt;border:1px solid #cbd5e1;border-radius:3pt;margin-right:4pt;page-break-inside:avoid;" />`).join("")
                  : '<span style="font-size:7pt;color:#94a3b8;">사진 없음</span>'}
              </td>` : '<td style="border:none;width:50%;vertical-align:top;"><span style="font-size:7pt;color:#94a3b8;">미완료 – 조치 후 사진 미표시</span></td>'}
            </tr></table>
          </td></tr>`;
        }

        return `<tr>
            <td class="center">${idx + 1}</td>
            <td>${itemLabel}</td>
            <td>${fb.description || ""}</td>
            <td class="center" style="color:${statusColor};font-weight:600;">${fb.status}</td>
            <td class="center">${fb.completed_at ? new Date(fb.completed_at).toLocaleDateString("ko-KR") : "-"}</td>
          </tr>${imagesHtml}`;
      }).join("");

      feedbackSection = `
        <div class="page-break"></div>
        <div class="section-header">피드백(조치관리) 결과</div>
        <div class="summary-text">총 ${feedbackWithImages.length}건 · 완료 ${feedbackWithImages.filter((f: any) => f.status === "완료").length}건 · 미조치 ${feedbackWithImages.filter((f: any) => f.status === "미조치").length}건</div>
        <table>
          <thead><tr><th>No</th><th>관련 항목</th><th>조치 내용</th><th>상태</th><th>완료일</th></tr></thead>
          <tbody>${fbRows}</tbody>
        </table>`;
    }

    // Validation section
    let validationSection = "";
    if (type === "validation" && validationResults.length > 0) {
      const vRows = validationResults.map((vr: any, i: number) =>
        `<tr><td class="center">${i + 1}</td><td>${vr.status}</td><td>${vr.message || ""}</td></tr>`
      ).join("");
      validationSection = `
        <div class="page-break"></div>
        <div class="section-header">검증 결과 리포트</div>
        <div class="summary-text">검증 점수: ${run.validation_score ?? "-"} / 판정: ${run.validation_verdict ?? "-"}</div>
        <table><thead><tr><th>#</th><th>상태</th><th>메시지</th></tr></thead><tbody>${vRows}</tbody></table>`;
    }

    // Managed risk items section
    const managedItems = items.filter((i: any) => i.improved_risk_grade === "상" && i.improvement_measure && i.improvement_measure.trim().length > 0);
    let managedSection = "";
    if (managedItems.length > 0) {
      const managedRows = managedItems.map((item: any, idx: number) => `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>${item.process || ""}</td>
          <td>${item.sub_task || ""}</td>
          <td>${item.hazard || ""}</td>
          <td>${item.improvement_measure || ""}</td>
          <td class="center grade" style="background:${gradeBg("상")};color:${gradeColor("상")};font-weight:bold">상</td>
          <td>${item.department || ""}</td>
          <td>${item.assignee || ""}</td>
        </tr>`).join("");
      managedSection = `
        <div class="section-header" style="margin-top:14pt;">관리대상 항목 (개선 후 위험도 '상')</div>
        <div class="summary-text">개선 대책이 수행되었으나 위험도가 '상'으로 유지되어 지속적 관리가 필요한 항목 (${managedItems.length}건)</div>
        <table>
          <thead><tr><th>No</th><th>공정</th><th>세부작업</th><th>위험요인</th><th>개선대책</th><th>위험도</th><th>부서</th><th>담당</th></tr></thead>
          <tbody>${managedRows}</tbody>
        </table>`;
    }

    // Worker participation images
    let workerImageSection = "";
    if (workerImages.length > 0) {
      workerImageSection = `
        <div class="section-header" style="margin-top:10pt;">근로자 참여 사진</div>
        <div style="display:flex;flex-wrap:wrap;gap:8pt;padding:4pt 0;">
          ${workerImages.map((b64: string) => `<img src="${b64}" style="max-width:200pt;max-height:150pt;border:1px solid #cbd5e1;border-radius:3pt;page-break-inside:avoid;" />`).join("")}
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; font-size: 9pt; color: #1e293b; line-height: 1.4; }
@page { size: A4 landscape; margin: 12mm 10mm; }
.page-break { page-break-before: always; }

.report-header {
  border: 2px solid #1e293b;
  margin-bottom: 10pt;
}
.report-title {
  background: #1e293b;
  color: white;
  text-align: center;
  padding: 8pt 0;
  font-size: 16pt;
  font-weight: 700;
  letter-spacing: 2pt;
}
.report-subtitle {
  text-align: center;
  padding: 4pt 0;
  font-size: 11pt;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}
.report-info {
  display: table;
  width: 100%;
  border-collapse: collapse;
}
.report-info-row { display: table-row; }
.report-info-label {
  display: table-cell;
  background: #f1f5f9;
  font-weight: 600;
  font-size: 8pt;
  padding: 4pt 8pt;
  border: 1px solid #e2e8f0;
  width: 80pt;
  white-space: nowrap;
  color: #334155;
}
.report-info-value {
  display: table-cell;
  font-size: 8pt;
  padding: 4pt 8pt;
  border: 1px solid #e2e8f0;
  color: #1e293b;
}

.section-header {
  font-size: 11pt;
  font-weight: 700;
  margin: 10pt 0 4pt;
  padding: 4pt 8pt;
  background: #f1f5f9;
  border-left: 4pt solid #1e293b;
}
.summary-text {
  font-size: 8pt;
  color: #475569;
  margin-bottom: 6pt;
  padding-left: 4pt;
}

/* Container for wide table with scaling */
.table-container {
  width: 100%;
  overflow-x: visible;
}
table { width: 100%; border-collapse: collapse; font-size: 7.5pt; margin-bottom: 10pt; table-layout: auto; }
th, td { border: 1px solid #cbd5e1; padding: 2pt 4pt; text-align: left; vertical-align: top; word-break: break-all; }
th { background: #1e293b; color: white; font-weight: 500; text-align: center; white-space: nowrap; font-size: 7pt; }
.center { text-align: center; }
.nowrap { white-space: nowrap; }
.grade { font-weight: 600; text-align: center; min-width: 18pt; }

.sig-table { width: auto; margin-top: 8pt; }
.sig-table th { background: #475569; }
.sig-table td { min-width: 60pt; height: 24pt; }
.sig-role { background: #f8fafc; font-weight: 500; }
.sig-stamp { min-width: 80pt; }

thead { display: table-header-group; }
img { max-width: 100%; height: auto; }
tr { page-break-inside: avoid; }
</style>
</head>
<body>
  <!-- Report Header -->
  <div class="report-header">
    <div class="report-title">디아이지에어가스 위험성평가표</div>
    <div class="report-subtitle">[${run.type}] ${run.period_label || ""}</div>
    <div class="report-info">
      <div class="report-info-row">
        <div class="report-info-label">프로젝트명</div>
        <div class="report-info-value">${project?.name || ""}</div>
        <div class="report-info-label">현장명</div>
        <div class="report-info-value">${project?.site_name || ""}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">발주처</div>
        <div class="report-info-value">${project?.client || ""}</div>
        <div class="report-info-label">시공사</div>
        <div class="report-info-value">${project?.contractor || ""}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">적용기간</div>
        <div class="report-info-value">${runPeriod}</div>
        <div class="report-info-label">항목수</div>
        <div class="report-info-value">${items.length}건 (상 ${highCount} / 중 ${medCount} / 하 ${lowCount})</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">검증결과</div>
        <div class="report-info-value">${run.validation_verdict || "-"} ${run.validation_score != null ? `(${run.validation_score}점)` : ""}</div>
        <div class="report-info-label">출력일</div>
        <div class="report-info-value">${today}</div>
      </div>
    </div>
  </div>

  <!-- Signature Section (top right area) -->
  <div class="section-header">서명란</div>
  <table class="sig-table">
    <thead><tr><th>구분</th><th>성명</th><th>소속</th><th>서명 / 일자</th></tr></thead>
    <tbody>${sigRows}</tbody>
  </table>

  <!-- Risk Assessment Table -->
  <div class="section-header">위험성평가 항목</div>
  <div class="table-container">
  <table>
    <thead>
      <tr>
        <th style="width:3%">No</th><th style="width:6%">공정</th><th style="width:7%">세부작업</th><th style="width:7%">위험요인</th><th style="width:8%">위험발생상황</th>
        <th style="width:8%">기존대책</th><th style="width:8%">개선대책</th>
        <th style="width:3%">가능성</th><th style="width:3%">중대성</th><th style="width:3%">위험도</th>
        <th style="width:3%">가능성'</th><th style="width:3%">중대성'</th><th style="width:3%">위험도'</th>
        <th style="width:4%">상태</th><th style="width:6%">PPE</th><th style="width:8%">법적근거</th><th style="width:5%">부서</th><th style="width:5%">담당</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="18" class="center">항목 없음</td></tr>'}
    </tbody>
  </table>
  </div>

  ${managedSection}

  ${feedbackSection}
  ${validationSection}

  <!-- Worker Participation Signature Page (always separate page) -->
  <div class="page-break"></div>
  <div class="section-header" style="text-align:center;border-left:none;font-size:14pt;padding:8pt;">근로자 참여 및 공유 서명</div>
  <div class="summary-text" style="text-align:center;margin-bottom:10pt;">본 위험성평가 내용을 교육받고 숙지하였음을 확인합니다.</div>
  <table>
    <thead><tr><th style="width:5%">No</th><th style="width:15%">소속</th><th style="width:15%">성명</th><th style="width:20%">서명</th><th style="width:5%">No</th><th style="width:15%">소속</th><th style="width:15%">성명</th><th style="width:20%">서명</th></tr></thead>
    <tbody>
      ${Array.from({ length: 15 }, (_, i) => `
        <tr>
          <td class="center" style="height:28pt;">${i * 2 + 1}</td><td></td><td></td><td></td>
          <td class="center" style="height:28pt;">${i * 2 + 2}</td><td></td><td></td><td></td>
        </tr>`).join("")}
    </tbody>
  </table>

  ${workerImageSection}

  <div style="text-align:right;font-size:7pt;color:#94a3b8;margin-top:4pt;">출력일: ${today}</div>
</body>
</html>`;

    return new Response(JSON.stringify({
      html, title: `위험성평가표 [${run.type}] ${run.period_label}`,
      fileName: `위험성평가_${run.type}_${run.period_label}_${today}.pdf`
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return new Response(
      JSON.stringify({ error: `PDF generation failed: ${error?.message || String(error)}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
