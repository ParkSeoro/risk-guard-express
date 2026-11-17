// Telegram Emergency Recovery & AI Council Webhook
// Allows the SafeNex director to check system health, roll back a broken OTA,
// or consult the AI Council (Gemini + Cursor Cloud Agent) from Telegram when away from PC.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DEFAULT_CURSOR_AGENT_ID = "bc-5c9ec1a0-6625-4210-a11b-d7595a9996eb";
const GEMINI_MODEL = "gemini-2.5-flash";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendTelegram(
  botToken: string,
  chatId: string | number,
  text: string,
) {
  if (!botToken || !chatId) return;
  const clipped = text.length > 3900 ? `${text.slice(0, 3890)}...` : text;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: clipped,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function askGeminiEmergency(
  apiKey: string,
  prompt: string,
  systemContext: string,
): Promise<string | null> {
  if (!apiKey) return null;
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: [
                "당신은 SafeNex 긴급 복구 AI 의회의 Gemini 의장이다.",
                "사용자는 PC를 쓸 수 없는 외부/퇴근 상황에서 텔레그램으로 긴급 장애 대응을 요청했다.",
                "현재 시스템 상태 컨텍스트를 바탕으로, 원인과 즉시 실행 가능한 복구 조치를 한국어로 간결하게 정리하라.",
              ].join(" "),
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: `[시스템 상태]\n${systemContext}\n\n[요청]\n${prompt}` }],
          },
        ],
      }),
    },
  );
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  return parts
    .map((p: { text?: string }) => p?.text || "")
    .join("")
    .trim() || null;
}

async function triggerCursorAgent(
  apiKey: string,
  agentId: string,
  prompt: string,
): Promise<{ ok: boolean; runId?: string; status?: string; text?: string; error?: string }> {
  if (!apiKey) return { ok: false, error: "CURSOR_API_KEY 미설정" };
  const headers = {
    Authorization: `Basic ${btoa(`${apiKey}:`)}`,
    "Content-Type": "application/json",
  };
  const startRes = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: {
        text: [
          "[텔레그램 긴급 복구 의회 요청]",
          "디렉터가 PC 없이 텔레그램으로 긴급 점검/복구 의견을 요청했습니다.",
          "코드와 최근 변경사항을 기준으로 원인과 안전한 복구 방안을 한국어로 간결히 답변하세요.",
          "",
          prompt,
        ].join("\n"),
      },
    }),
  });
  if (!startRes.ok) {
    return { ok: false, error: `Cursor HTTP ${startRes.status}` };
  }
  const startJson = await startRes.json().catch(() => ({}));
  const runId = startJson?.run?.id;
  if (typeof runId !== "string") {
    return { ok: false, error: "Cursor runId 없음" };
  }

  // Poll briefly (up to ~12s) so fast replies arrive in one turn
  for (let i = 0; i < 6; i += 1) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(
      `https://api.cursor.com/v1/agents/${agentId}/runs/${runId}`,
      { headers },
    );
    if (!pollRes.ok) continue;
    const pollJson = await pollRes.json().catch(() => ({}));
    const status = String(pollJson?.status || "");
    if (status === "FINISHED") {
      return { ok: true, runId, status, text: String(pollJson?.result || "").trim() };
    }
    if (status === "ERROR" || status === "CANCELLED" || status === "EXPIRED") {
      return { ok: false, runId, status, error: `Cursor ${status}` };
    }
  }
  return { ok: true, runId, status: "RUNNING" };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ ok: true, service: "telegram-council-webhook" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
  const ALLOWED_CHAT_ID = (Deno.env.get("TELEGRAM_ALLOWED_CHAT_ID") ?? "").trim();
  const WEBHOOK_SECRET = (Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "").trim();
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
  const CURSOR_API_KEY = Deno.env.get("CURSOR_API_KEY") ?? "";
  const CURSOR_AGENT_ID =
    Deno.env.get("CURSOR_COUNCIL_AGENT_ID") || DEFAULT_CURSOR_AGENT_ID;

  if (WEBHOOK_SECRET) {
    const hdr = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (hdr !== WEBHOOK_SECRET) {
      return json({ ok: false, error: "invalid_secret" }, 401);
    }
  }

  const update = await req.json().catch(() => null);
  const msg = update?.message || update?.edited_message;
  const chatId = msg?.chat?.id ? String(msg.chat.id) : "";
  const text = typeof msg?.text === "string" ? msg.text.trim() : "";

  if (!chatId || !text) {
    return json({ ok: true, ignored: true });
  }

  if (!ALLOWED_CHAT_ID || chatId !== ALLOWED_CHAT_ID) {
    if (BOT_TOKEN) {
      await sendTelegram(
        BOT_TOKEN,
        chatId,
        `⛔ 권한이 없는 채팅입니다. (chat_id: <code>${escapeHtml(chatId)}</code>)`,
      );
    }
    return json({ ok: false, error: "forbidden_chat" }, 200);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const lower = text.toLowerCase();

  if (lower === "/start" || lower === "/help" || text === "/도움말") {
    await sendTelegram(
      BOT_TOKEN,
      chatId,
      [
        "<b>🛡️ SafeNex 긴급 복구 · AI 의회</b>",
        "",
        "• <code>/상태</code> — DB·OTA 실시간 서버 상태 점검",
        "• <code>/ota</code> — 최근 모바일/PC OTA 버전 조회",
        "• <code>/ota롤백 android</code> 또는 <code>/ota롤백 desktop</code> — 최신 OTA 긴급 비활성화",
        "• <code>/의회 [질문/장애내용]</code> 또는 일반 메시지 — AI 의회(Gemini + Cursor) 긴급 진단",
      ].join("\n"),
    );
    return json({ ok: true });
  }

  if (lower === "/status" || text === "/상태") {
    const startMs = Date.now();
    const [{ count, error: dbErr }, { data: phoneOta }, { data: pcOta }] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.rpc("get_latest_app_release", { _channel: "stable", _platform: "android" }),
      admin.rpc("get_latest_app_release", { _channel: "stable", _platform: "desktop" }),
    ]);
    const latency = Date.now() - startMs;
    const pVer = Array.isArray(phoneOta) && phoneOta[0] ? phoneOta[0].version : "없음";
    const dVer = Array.isArray(pcOta) && pcOta[0] ? pcOta[0].version : "없음";
    await sendTelegram(
      BOT_TOKEN,
      chatId,
      [
        `<b>${dbErr ? "🔴 DB 연결 이상" : "🟢 SafeNex 서버 정상"}</b> (${latency}ms)`,
        `• DB 응답: ${dbErr ? escapeHtml(dbErr.message) : `정상 (프로필 ${count ?? 0}건)`}`,
        `• 폰 OTA: <code>${escapeHtml(String(pVer))}</code>`,
        `• PC OTA: <code>${escapeHtml(String(dVer))}</code>`,
      ].join("\n"),
    );
    return json({ ok: true });
  }

  if (lower === "/ota") {
    const { data: rows, error } = await admin
      .from("mobile_ota_releases")
      .select("id, version, platform, channel, is_active, created_at")
      .order("created_at", { ascending: false })
      .limit(6);

    if (error) {
      await sendTelegram(BOT_TOKEN, chatId, `❌ OTA 조회 실패: ${escapeHtml(error.message)}`);
      return json({ ok: true });
    }
    const lines = (rows || []).map(
      (r: any) =>
        `• [${r.is_active ? "활성" : "중지"}] <b>${escapeHtml(String(r.platform))}</b> <code>${escapeHtml(String(r.version))}</code> (${escapeHtml(String(r.channel))})`,
    );
    await sendTelegram(
      BOT_TOKEN,
      chatId,
      `<b>📦 최근 OTA 배포 목록</b>\n${lines.join("\n") || "없음"}`,
    );
    return json({ ok: true });
  }

  if (lower.startsWith("/rollback") || text.startsWith("/ota롤백")) {
    const platform = text.split(/\s+/)[1]?.toLowerCase();
    if (platform !== "android" && platform !== "desktop" && platform !== "ios") {
      await sendTelegram(
        BOT_TOKEN,
        chatId,
        "사용법: <code>/ota롤백 android</code> 또는 <code>/ota롤백 desktop</code>",
      );
      return json({ ok: true });
    }
    const { data: latest } = await admin
      .from("mobile_ota_releases")
      .select("id, version")
      .eq("platform", platform)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latest) {
      await sendTelegram(BOT_TOKEN, chatId, `활성화된 ${platform} OTA 릴리즈가 없습니다.`);
      return json({ ok: true });
    }

    const { error: updErr } = await admin
      .from("mobile_ota_releases")
      .update({ is_active: false })
      .eq("id", latest.id);

    if (updErr) {
      await sendTelegram(BOT_TOKEN, chatId, `❌ 롤백 실패: ${escapeHtml(updErr.message)}`);
    } else {
      await sendTelegram(
        BOT_TOKEN,
        chatId,
        `✅ <b>${escapeHtml(platform)}</b> 최신 OTA(<code>${escapeHtml(latest.version)}</code>)를 긴급 비활성화했습니다.`,
      );
    }
    return json({ ok: true });
  }

  // Default: AI Council (Gemini + Cursor Cloud Agent)
  const agenda = text.replace(/^\/(의회|council|복구)\s*/i, "").trim();
  if (!agenda) {
    await sendTelegram(BOT_TOKEN, chatId, "질문이나 장애 내용을 입력해 주세요.");
    return json({ ok: true });
  }

  await sendTelegram(BOT_TOKEN, chatId, "🏛️ <b>SafeNex AI 의회</b>에 긴급 분석을 요청했습니다...");

  const [{ error: dbErr }, { data: phoneOta }, { data: pcOta }] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.rpc("get_latest_app_release", { _channel: "stable", _platform: "android" }),
    admin.rpc("get_latest_app_release", { _channel: "stable", _platform: "desktop" }),
  ]);

  const sysContext = [
    `DB 상태: ${dbErr ? `오류(${dbErr.message})` : "정상"}`,
    `폰 OTA: ${Array.isArray(phoneOta) && phoneOta[0] ? phoneOta[0].version : "없음"}`,
    `PC OTA: ${Array.isArray(pcOta) && pcOta[0] ? pcOta[0].version : "없음"}`,
  ].join("\n");

  const [geminiReply, cursorRes] = await Promise.all([
    askGeminiEmergency(GEMINI_API_KEY, agenda, sysContext),
    triggerCursorAgent(CURSOR_API_KEY, CURSOR_AGENT_ID, agenda),
  ]);

  const parts: string[] = [];
  if (geminiReply) {
    parts.push(`<b>🤖 Gemini 의장</b>\n${escapeHtml(geminiReply)}`);
  }
  if (cursorRes.ok && cursorRes.text) {
    parts.push(`<b>💻 Cursor 에이전트</b>\n${escapeHtml(cursorRes.text)}`);
  } else if (cursorRes.ok && cursorRes.status === "RUNNING") {
    parts.push(
      `<b>💻 Cursor 에이전트</b>\n백그라운드에서 코드 분석 진행 중 (run: <code>${escapeHtml(cursorRes.runId || "")}</code>)`,
    );
  } else if (!geminiReply) {
    parts.push(
      `⚠️ AI 의회 키가 설정되지 않았습니다. (GEMINI_API_KEY / CURSOR_API_KEY 확인 필요)`,
    );
  }

  await sendTelegram(BOT_TOKEN, chatId, parts.join("\n\n───────────────────\n\n"));
  return json({ ok: true });
});
