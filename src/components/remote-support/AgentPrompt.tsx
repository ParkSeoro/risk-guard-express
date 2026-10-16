import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  acceptRemoteSupportSession,
  rejectRemoteSupportSession,
  type RemoteSupportSession,
} from "@/lib/remoteSupport";

type Props = {
  session: RemoteSupportSession | null;
  requesterName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccepted?: (session: RemoteSupportSession) => void;
  onRejected?: () => void;
};

export function RemoteSupportAgentPrompt({
  session,
  requesterName,
  open,
  onOpenChange,
  onAccepted,
  onRejected,
}: Props) {
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    if (!session) return;
    setBusy(true);
    try {
      const next = await acceptRemoteSupportSession(session.id);
      toast.success("원격지원을 수락했습니다.");
      onOpenChange(false);
      onAccepted?.(next);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "수락에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await rejectRemoteSupportSession(session.id);
      toast.message("요청을 거절했습니다.");
      onOpenChange(false);
      onRejected?.();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "거절에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Pending support requests must be accepted or rejected — ignore overlay/Esc dismiss.
        if (!next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        hideClose
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>원격지원 요청</DialogTitle>
          <DialogDescription>
            {(requesterName || "현장 사용자") +
              "님이 원격지원을 요청했습니다. 수락하면 화면을 보고 SafeNex 메뉴를 함께 조작할 수 있습니다."}
          </DialogDescription>
        </DialogHeader>
        {session?.requester_path && (
          <p className="text-xs text-muted-foreground break-all">현재 화면: {session.requester_path}</p>
        )}
        <p className="text-[11px] text-muted-foreground">수락 또는 거절을 선택해 주세요. 바깥을 눌러도 창이 닫히지 않습니다.</p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void reject()}>
            거절
          </Button>
          <Button type="button" disabled={busy} onClick={() => void accept()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            수락
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
