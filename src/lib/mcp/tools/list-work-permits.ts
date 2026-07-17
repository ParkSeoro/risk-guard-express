import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_work_permits",
  title: "작업허가서 목록",
  description: "프로젝트의 작업허가서(상태/유형 필터 가능)를 최대 50건 조회합니다.",
  inputSchema: {
    project_id: z.string().uuid().describe("프로젝트 UUID"),
    status: z.string().optional().describe("승인 상태 필터 (예: approved, pending)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ project_id, status }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "인증되지 않았습니다." }], isError: true };
    }
    const sb = supabaseForUser(ctx);
    let q = sb
      .from("work_permits")
      .select("id,title,permit_type,status,permit_date,valid_until,created_at")
      .eq("project_id", project_id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { permits: data ?? [] },
    };
  },
});
