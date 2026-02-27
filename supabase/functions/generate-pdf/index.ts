import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create a user-scoped client to validate JWT and enforce RLS
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT token
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { runId, type } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Use user-scoped client to verify access (RLS enforces project membership)
    const { data: run, error: runError } = await userClient
      .from("assessment_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Not found or access denied" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Now use service client for remaining data fetching (user access already verified)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: project } = await supabase
      .from("projects")
      .select("*")
      .eq("id", run.project_id)
      .single();

    const { data: items } = await supabase
      .from("risk_items")
      .select("*")
      .eq("run_id", runId)
      .order("sort_order");

    const { data: participants } = await supabase
      .from("assessment_run_participants")
      .select("*")
      .eq("run_id", runId);

    // Fetch validation results if type is 'validation'
    let validationResults: any[] = [];
    if (type === "validation") {
      const { data: vr } = await supabase
        .from("validation_results")
        .select("*")
        .eq("run_id", runId);
      validationResults = vr || [];
    }

    const gradeColor = (g: string) =>
      g === "상"
        ? "#dc2626"
        : g === "중"
        ? "#d97706"
        : "#16a34a";

    const gradeBg = (g: string) =>
      g === "상"
        ? "#fecaca"
        : g === "중"
        ? "#fef08a"
        : "#bbf7d0";

    const today = new Date().toISOString().slice(0, 10);
    const title = `디아이지에어가스 위험성평가 [${run.type}] ${run.period_label}`;

    // Build signature table
    const roles = ["작성자", "검토자", "승인자", "협력사 담당자", "안전관리자"];
    const sigRows = roles
      .map((role) => {
        const people = (participants || []).filter(
          (p: any) => p.role === role
        );
        if (people.length === 0) {
          return `<tr><td>${role}</td><td></td><td></td><td></td></tr>`;
        }
        return people
          .map(
            (p: any) =>
              `<tr><td>${role}</td><td>${p.user_name || ""}</td><td>${
                p.company || ""
              }</td><td>${
                p.signed_at
                  ? new Date(p.signed_at).toLocaleDateString("ko-KR")
                  : ""
              }</td></tr>`
          )
          .join("");
      })
      .join("");

    // Build risk items table rows
    const itemRows = (items || [])
      .map(
        (item: any, i: number) => `
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
        <td>${(item.legal_basis || []).join(", ")}</td>
        <td>${item.department || ""}</td>
        <td>${item.assignee || ""}</td>
      </tr>`
      )
      .join("");

    // Validation section
    let validationSection = "";
    if (type === "validation" && validationResults.length > 0) {
      const vRows = validationResults
        .map(
          (vr: any, i: number) =>
            `<tr><td class="center">${i + 1}</td><td>${vr.status}</td><td>${vr.message || ""}</td></tr>`
        )
        .join("");
      validationSection = `
        <div class="page-break"></div>
        <h2>검증 결과 리포트</h2>
        <p>검증 점수: ${run.validation_score ?? "-"} / 판정: ${run.validation_verdict ?? "-"}</p>
        <table>
          <thead><tr><th>#</th><th>상태</th><th>메시지</th></tr></thead>
          <tbody>${vRows}</tbody>
        </table>
      `;
    }

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif;
  font-size: 9pt;
  color: #1e293b;
  line-height: 1.4;
}
@page {
  size: A4 landscape;
  margin: 12mm 10mm;
}
.page-break { page-break-before: always; }
h1 { font-size: 16pt; margin-bottom: 4pt; }
h2 { font-size: 12pt; margin: 12pt 0 6pt; }
.meta { font-size: 9pt; color: #475569; margin-bottom: 8pt; }
.meta span { margin-right: 16pt; }
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 8pt;
  margin-bottom: 12pt;
}
th, td {
  border: 1px solid #cbd5e1;
  padding: 3pt 5pt;
  text-align: left;
  vertical-align: top;
  word-break: break-all;
}
th {
  background: #1e293b;
  color: white;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
}
.center { text-align: center; }
.nowrap { white-space: nowrap; }
.grade { font-weight: 600; text-align: center; min-width: 20pt; }
.sig-table { width: auto; margin-top: 12pt; }
.sig-table th { background: #64748b; }
.sig-table td { min-width: 60pt; height: 24pt; }
.cover { text-align: center; padding-top: 100pt; }
.cover h1 { font-size: 22pt; margin-bottom: 8pt; }
.cover .sub { font-size: 14pt; color: #475569; margin-bottom: 40pt; }
.cover .info { font-size: 11pt; color: #334155; line-height: 1.8; }
thead { display: table-header-group; }
</style>
</head>
<body>
  <!-- Cover -->
  <div class="cover">
    <h1>디아이지에어가스 위험성평가 시스템</h1>
    <div class="sub">${title}</div>
    <div class="info">
      프로젝트: ${project?.name || ""}<br>
      현장명: ${project?.site_name || ""}<br>
      발주사: ${project?.client || ""} / 시공사: ${project?.contractor || ""}<br>
      기간: ${project?.period_start || ""} ~ ${project?.period_end || ""}<br>
      출력일: ${today}
    </div>
  </div>

  <div class="page-break"></div>

  <!-- Main Table -->
  <h2>${title} - 위험성평가표</h2>
  <div class="meta">
    <span>항목 ${(items || []).length}건</span>
    <span>출력일: ${today}</span>
  </div>
  <table>
    <thead>
      <tr>
        <th>No</th><th>공정</th><th>세부작업</th><th>위험요인</th><th>위험발생상황</th>
        <th>기존대책</th><th>개선대책</th>
        <th>가능성</th><th>중대성</th><th>위험도</th>
        <th>가능성'</th><th>중대성'</th><th>위험도'</th>
        <th>상태</th><th>PPE</th><th>법적근거</th><th>부서</th><th>담당</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="18" class="center">항목 없음</td></tr>'}
    </tbody>
  </table>

  <!-- Signature -->
  <h2>서명란</h2>
  <table class="sig-table">
    <thead><tr><th>구분</th><th>성명</th><th>소속</th><th>서명/일자</th></tr></thead>
    <tbody>${sigRows}</tbody>
  </table>

  ${validationSection}
</body>
</html>`;

    // Return HTML that can be rendered as PDF by the client
    return new Response(JSON.stringify({ html, title, fileName: `위험성평가_${run.type}_${run.period_label}_${today}.pdf` }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
