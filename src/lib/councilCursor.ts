import { supabase } from "@/integrations/supabase/client";

const POLL_MS = 3000;
const WAIT_MS = 4 * 60 * 1000;

type CouncilCursorBody = {
  ok?: boolean;
  runId?: string;
  done?: boolean;
  text?: string;
  message?: string;
};

function messageFrom(body: CouncilCursorBody | null, fallback: string) {
  return body?.message || fallback;
}

async function invoke(body: Record<string, string>) {
  const { data, error } = await supabase.functions.invoke("council-cursor", { body });
  if (error) throw new Error(error.message || "Cursor 함수 호출에 실패했습니다.");
  return (data || null) as CouncilCursorBody | null;
}

/** Ask the cloud agent bound to this council, then wait for its reply. */
export async function askCouncilCursor(opts: { agenda: string; prior?: string }) {
  const started = await invoke({
    action: "start",
    agenda: opts.agenda,
    prior: opts.prior ?? "",
  });
  if (!started?.ok || !started.runId) {
    throw new Error(messageFrom(started, "Cursor 연결에 실패했습니다."));
  }

  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const status = await invoke({ action: "status", runId: started.runId });
    if (!status?.ok) throw new Error(messageFrom(status, "Cursor 상태를 읽지 못했습니다."));
    if (status.done) return status.text || "(응답 없음)";
  }
  throw new Error("Cursor 답변 대기 시간이 끝났습니다. 이 대화 창에서 이어서 확인할 수 있습니다.");
}
