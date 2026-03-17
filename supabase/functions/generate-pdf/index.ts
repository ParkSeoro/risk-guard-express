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

    const [projectRes, itemsRes, participantsRes, feedbackRes, validationRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", run.project_id).single(),
      supabase.from("risk_items").select("*").eq("run_id", runId).order("sort_order"),
      supabase.from("assessment_run_participants").select("*").eq("run_id", runId),
      supabase.from("risk_item_feedback").select("*").eq("assessment_run_id", runId),
      type === "validation"
        ? supabase.from("validation_results").select("*").eq("run_id", runId)
        : Promise.resolve({ data: [] }),
    ]);

    const project = projectRes.data;
    const items = itemsRes.data || [];
    const participants = participantsRes.data || [];
    const feedbackItems = feedbackRes.data || [];
    const validationResults = (validationRes as any).data || [];

    // Convert feedback images to base64
    const feedbackWithImages = await Promise.all(
      feedbackItems.map(async (fb: any) => {
        const beforeImages: string[] = [];
        const afterImages: string[] = [];
        for (const url of (fb.before_image_urls || []).slice(0, 3)) {
          const b64 = await imageUrlToBase64(url);
          if (b64) beforeImages.push(b64);
        }
        for (const url of (fb.after_image_urls || []).slice(0, 3)) {
          const b64 = await imageUrlToBase64(url);
          if (b64) afterImages.push(b64);
        }
        return { ...fb, beforeBase64: beforeImages, afterBase64: afterImages };
      })
    );

    const gradeColor = (g: string) =>
      g === "상" ? "#dc2626" : g === "중" ? "#d97706" : "#16a34a";
    const gradeBg = (g: string) =>
      g === "상" ? "#fecaca" : g === "중" ? "#fef08a" : "#bbf7d0";

    const today = new Date().toISOString().slice(0, 10);
    const runPeriod = run.start_date && run.end_date
      ? `${run.start_date} ~ ${run.end_date}`
      : `${project?.period_start || ""} ~ ${project?.period_end || ""}`;
    const title = `위험성평가표 [${run.type}] ${run.period_label}`;

    // Stats
    const highCount = items.filter((i: any) => i.risk_grade === "상").length;
    const medCount = items.filter((i: any) => i.risk_grade === "중").length;
    const lowCount = items.filter((i: any) => i.risk_grade === "하").length;

    // Signature rows
    const roles = ["작성자", "검토자", "승인자", "안전관리자", "협력사 담당자"];
    const sigRows = roles.map((role) => {
      const people = participants.filter((p: any) => p.role === role);
      if (people.length === 0) return `<tr><td class="sig-role">${role}</td><td></td><td></td><td class="sig-stamp"></td></tr>`;
      return people.map((p: any) =>
        `<tr><td class="sig-role">${role}</td><td>${p.user_name || ""}</td><td>${p.company || ""}</td><td class="sig-stamp">${p.signed_at ? new Date(p.signed_at).toLocaleDateString("ko-KR") : ""}</td></tr>`
      ).join("");
    }).join("");

    // Risk items table
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
        <td>${item.department || ""}</td>
        <td>${item.assignee || ""}</td>
      </tr>`).join("");

    // Feedback section - Before always shown, After only when status=완료
    let feedbackSection = "";
    if (feedbackWithImages.length > 0) {
      const fbRows = feedbackWithImages.map((fb: any, idx: number) => {
        const item = items.find((i: any) => i.id === fb.risk_item_id);
        const itemLabel = item ? `${item.process} – ${item.sub_task || ""}` : "(전체)";
        const statusColor = fb.status === "완료" ? "#16a34a" : fb.status === "진행중" ? "#d97706" : "#dc2626";
        const showAfter = fb.status === "완료";

        let imagesHtml = "";
        // Always show Before; show After only when 완료
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

/* Report header */
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
.report-info-row {
  display: table-row;
}
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

table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-bottom: 10pt; }
th, td { border: 1px solid #cbd5e1; padding: 3pt 5pt; text-align: left; vertical-align: top; word-break: break-all; }
th { background: #1e293b; color: white; font-weight: 500; text-align: center; white-space: nowrap; }
.center { text-align: center; }
.nowrap { white-space: nowrap; }
.grade { font-weight: 600; text-align: center; min-width: 20pt; }

.sig-table { width: auto; margin-top: 8pt; }
.sig-table th { background: #475569; }
.sig-table td { min-width: 60pt; height: 24pt; }
.sig-role { background: #f8fafc; font-weight: 500; }
.sig-stamp { min-width: 80pt; }

.risk-summary {
  display: inline-flex;
  gap: 8pt;
  font-size: 9pt;
  font-weight: 600;
  margin-bottom: 6pt;
}
.risk-dot { display: inline-block; width: 8pt; height: 8pt; border-radius: 50%; margin-right: 2pt; vertical-align: middle; }

thead { display: table-header-group; }
img { max-width: 100%; height: auto; }
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

  <!-- Risk Assessment Table -->
  <div class="section-header">위험성평가 항목</div>
  <table>
    <thead>
      <tr>
        <th>No</th><th>공정</th><th>세부작업</th><th>위험요인</th><th>위험발생상황</th>
        <th>기존대책</th><th>개선대책</th>
        <th>가능성</th><th>중대성</th><th>위험도</th>
        <th>가능성'</th><th>중대성'</th><th>위험도'</th>
        <th>상태</th><th>PPE</th><th>부서</th><th>담당</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="17" class="center">항목 없음</td></tr>'}
    </tbody>
  </table>

  <!-- Signature Section -->
  <div class="section-header">서명란</div>
  <table class="sig-table">
    <thead><tr><th>구분</th><th>성명</th><th>소속</th><th>서명 / 일자</th></tr></thead>
    <tbody>${sigRows}</tbody>
  </table>

  ${feedbackSection}
  ${validationSection}
</body>
</html>`;

    return new Response(JSON.stringify({
      html, title,
      fileName: `위험성평가_${run.type}_${run.period_label}_${today}.pdf`
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "PDF generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
