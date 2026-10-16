import { Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRemoteSupportOptional } from "@/components/remote-support/RemoteSupportHost";

/** Header chip for agents with a pending request — reopens the accept dialog. */
export function RemoteSupportAgentPendingBadge() {
  const rs = useRemoteSupportOptional();
  if (!rs?.agentPendingSession) return null;

  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      className="h-8 gap-1.5 px-2 bg-amber-600 hover:bg-amber-700 text-white animate-pulse"
      onClick={() => rs.openAgentPrompt()}
      title="원격지원 요청 대기 — 클릭하여 수락/거절"
      aria-label="원격지원 요청 대기"
    >
      <Headset className="h-4 w-4" />
      <span className="text-xs font-semibold">요청 대기</span>
    </Button>
  );
}
