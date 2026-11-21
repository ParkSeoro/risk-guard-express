import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-backup-trigger-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatBytes(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = n;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx >= 2 ? 1 : 0)} ${units[idx]}`;
}

const JOB_LABELS: Record<string, string> = {
  "scan-work-plan-end-warnings": "작업계획서 종료 임박 점검",
  "daily-consistency-audit": "데이터 정합성 감사",
  "purge-worker-last-positions-0330-kst": "오래된 근로자 위치정보 정리",
  "safenex-nightly-gdrive-backup": "Google One 백업 스케줄러",
  "anonymize-location-daily": "위치정보 익명화",
  "run-weekly-safety-report": "주간 안전보고서 생성",
};

interface CronJobSummary {
  jobname: string;
  runs: number;
  succeeded: number;
  failed: number;
  last_status: string;
  last_start_kst: string;
  last_error?: string | null;
}

interface NightlyOpsReport {
  report_date_kst: string;
  generated_at_kst: string;
  backup: {
    ticks: number;
    copied: number;
    verified: number;
    purged: number;
    skipped: number;
    errors: number;
    circuit_broken: boolean;
    mode: string | null;
    quota_used_bytes: number | null;
    quota_limit_bytes: number | null;
    last_finished_kst: string | null;
    notes: string[];
  };
  archive: {
    total_backed_up: number;
    total_purged: number;
    total_bytes: number;
    failed_count: number;
  };
  cron_jobs: CronJobSummary[];
  consistency_issues: number;
  consistency_error: string | null;
}

function buildTelegramHtml(report: NightlyOpsReport): { html: string; status: "OK" | "WARNING" | "CRITICAL" } {
  const b = report.backup;
  const a = report.archive;
  const otherJobs = (report.cron_jobs || []).filter((j) => j.jobname !== "safenex-nightly-gdrive-backup");
  const backupCron = (report.cron_jobs || []).find((j) => j.jobname === "safenex-nightly-gdrive-backup");

  const alerts: string[] = [];
  let status: "OK" | "WARNING" | "CRITICAL" = "OK";

  if (b.circuit_broken) {
    status = "CRITICAL";
    alerts.push("Google One 백업 서킷 브레이커 발동");
  }
  if (b.errors > 0) {
    status = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    alerts.push(`Google One 백업 오류 ${b.errors}건`);
  }
  if (b.ticks === 0) {
    status = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    alerts.push("오늘 새벽 Google One 백업 실행 기록 없음");
  }
  if (backupCron && backupCron.failed > 0) {
    status = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    alerts.push(`백업 크론 실패 ${backupCron.failed}/${backupCron.runs}회`);
  }
  for (const job of otherJobs) {
    if (job.failed > 0) {
      status = "CRITICAL";
      const label = JOB_LABELS[job.jobname] || job.jobname;
      alerts.push(`${label} 실패 (${escapeHtml(String(job.last_error || job.last_status))})`);
    }
  }
  if (report.consistency_error) {
    status = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    alerts.push(`데이터 정합성 조회 오류: ${escapeHtml(report.consistency_error)}`);
  } else if (report.consistency_issues > 0) {
    status = status === "CRITICAL" ? "CRITICAL" : "WARNING";
    alerts.push(`데이터 정합성 결함 ${report.consistency_issues}건 (/admin/data-audit)`);
  }

  const badge =
    status === "OK"
      ? "🟢 <b>전체 정상</b>"
      : status === "WARNING"
        ? "🟡 <b>주의 필요</b>"
        : "🔴 <b>오류 확인 필요</b>";

  const modeLabel =
    b.mode === "backup_and_purge"
      ? "백업+정리"
      : b.mode === "backup_only"
        ? "백업 전용"
        : b.mode || "미실행";

  let quotaLine = "";
  if (b.quota_used_bytes && b.quota_limit_bytes && b.quota_limit_bytes > 0) {
    const pct = ((b.quota_used_bytes / b.quota_limit_bytes) * 100).toFixed(1);
    quotaLine = `• <b>Google One 용량</b>: ${formatBytes(b.quota_used_bytes)} / ${formatBytes(b.quota_limit_bytes)} (${pct}%)\n`;
  }

  const lines: string[] = [];
  lines.push(`🌙 <b>SafeNex 새벽 작업 일일 리포트</b>`);
  lines.push(`<code>${escapeHtml(report.report_date_kst)}</code> · ${badge}`);
  lines.push(`───────────────────────`);

  // 1. Google One Backup
  lines.push(`📦 <b>Google One 장기 백업</b> (02:05~03:55)`);
  if (b.ticks > 0) {
    lines.push(
      `• 실행: <b>${b.ticks}회</b> (${escapeHtml(modeLabel)}${b.last_finished_kst ? `, 최종 ${escapeHtml(b.last_finished_kst)}` : ""})`,
    );
    lines.push(
      `• 새벽 실적: 신규 <b>${b.copied}건</b> · 검증 <b>${b.verified}건</b> · 정리 <b>${b.purged}건</b> · 오류 <b>${b.errors}건</b>`,
    );
  } else {
    lines.push(`• 오늘 새벽 실행 기록 없음`);
  }
  lines.push(
    `• 누적 백업: <b>${a.total_backed_up.toLocaleString("ko-KR")}건</b> (${formatBytes(a.total_bytes)})${a.failed_count > 0 ? ` · 실패 ${a.failed_count}건` : ""}`,
  );
  if (quotaLine) lines.push(quotaLine.trimEnd());

  // 2. Overnight batch jobs
  lines.push(``);
  lines.push(`⚙️ <b>새벽 정기 작업 현황</b>`);
  if (otherJobs.length === 0) {
    lines.push(`• 기록된 새벽 배치 작업 없음`);
  } else {
    for (const job of otherJobs) {
      const label = JOB_LABELS[job.jobname] || job.jobname;
      const icon = job.failed > 0 ? "❌" : "✅";
      let extra = "";
      if (job.jobname === "daily-consistency-audit" && !report.consistency_error) {
        extra = ` (결함 ${report.consistency_issues}건)`;
      }
      lines.push(`• ${icon} <code>${escapeHtml(job.last_start_kst)}</code> ${escapeHtml(label)}${extra}`);
    }
  }

  lines.push(`───────────────────────`);
  if (alerts.length > 0) {
    lines.push(`🚨 <b>확인 필요</b>`);
    for (const alert of alerts.slice(0, 6)) {
      lines.push(`  • ${alert}`);
    }
  } else {
    lines.push(`✨ <i>새벽 자동 작업 모두 이상 없이 완료되었습니다.</i>`);
  }

  return { html: lines.join("\n"), status };
}

async function getRuntimeSecret(admin: ReturnType<typeof createClient>, key: string): Promise<string> {
  const fromEnv = (Deno.env.get(key) || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { data } = await admin.rpc("get_runtime_secret", { secret_name: key });
    if (typeof data === "string" && data.trim()) return data.trim();
  } catch {
    // ignore
  }
  return "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonRes({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const triggerSecret = await getRuntimeSecret(supabase, "BACKUP_TRIGGER_SECRET");
  const providedSecret = (req.headers.get("x-backup-trigger-secret") ?? "").trim();
  const authHeader = (req.headers.get("authorization") ?? "").trim();

  const authorizedBySecret = triggerSecret.length > 0 && providedSecret === triggerSecret;
  const authorizedByServiceRole = serviceRoleKey.length > 0 && authHeader === `Bearer ${serviceRoleKey}`;
  if (!authorizedBySecret && !authorizedByServiceRole) {
    return jsonRes({ error: "Unauthorized" }, 401);
  }

  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dry_run === true;
  } catch {
    // empty body is fine
  }

  const { data: report, error: rpcErr } = await supabase.rpc("get_nightly_ops_report");
  if (rpcErr || !report) {
    return jsonRes({ error: rpcErr?.message || "Failed to load nightly report" }, 500);
  }

  const { html, status } = buildTelegramHtml(report as NightlyOpsReport);

  if (dryRun) {
    return jsonRes({ ok: true, dry_run: true, status, html, report });
  }

  const botToken = await getRuntimeSecret(supabase, "TELEGRAM_BOT_TOKEN");
  const chatId =
    (await getRuntimeSecret(supabase, "TELEGRAM_CHAT_ID")) ||
    (await getRuntimeSecret(supabase, "TELEGRAM_ALLOWED_CHAT_ID"));
  if (!botToken || !chatId) {
    return jsonRes({ error: "Telegram secrets not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_CHAT_ID)" }, 500);
  }

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!tgRes.ok) {
    const errText = await tgRes.text();
    return jsonRes({ error: `Telegram send failed (${tgRes.status}): ${errText}` }, 502);
  }

  return jsonRes({ ok: true, status, sent: true, report_date_kst: (report as NightlyOpsReport).report_date_kst });
});
