import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";
import {
  canSubmitRemoteSupportRequest,
  createRemoteSupportSession,
  fetchActiveAgents,
  type RemoteSupportAgent,
} from "@/lib/remoteSupport";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (sessionId: string) => void;
};

export function RemoteSupportRequestDialog({ open, onOpenChange, onCreated }: Props) {
  const { user } = useAuth();
  const access = useGlobalProjectAccessOptional();
  const location = useLocation();
  const [agents, setAgents] = useState<RemoteSupportAgent[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [contactedConfirmed, setContactedConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setContactedConfirmed(false);
    setLoading(true);
    void fetchActiveAgents()
      .then((rows) => {
        setAgents(rows);
        setSelected(rows[0]?.user_id || "");
      })
      .catch((err: Error) => {
        toast.error(err.message || "담당자 목록을 불러오지 못했습니다.");
      })
      .finally(() => setLoading(false));
  }, [open]);

  const canSubmit = canSubmitRemoteSupportRequest({
    contactedConfirmed,
    agentId: selected,
  });

  const submit = async () => {
    if (!user || !canSubmit) return;
    setSubmitting(true);
    try {
      const session = await createRemoteSupportSession({
        requesterId: user.id,
        agentId: selected,
        projectId: access?.selectedProject || null,
        requesterPath: `${location.pathname}${location.search}`,
      });
      toast.success("원격지원을 요청했습니다. 담당자 수락을 기다려 주세요.");
      onOpenChange(false);
      onCreated?.(session.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "요청에 실패했습니다.";
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>원격지원 요청</DialogTitle>
          <DialogDescription>
            전화·메신저 등으로 담당자에게 먼저 연락한 뒤 요청해 주세요. 수락 후 화면공유와 앱 공동조작이
            시작됩니다.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            지정된 담당자가 없습니다. 마스터에게 설정 &gt; 원격지원 담당자에서 지정해 달라고 요청하세요.
          </p>
        ) : (
          <div className="space-y-4">
            <RadioGroup value={selected} onValueChange={setSelected} className="gap-2">
              {agents.map((agent) => (
                <Label
                  key={agent.id}
                  htmlFor={`rs-agent-${agent.id}`}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 cursor-pointer hover:bg-accent/40"
                >
                  <RadioGroupItem id={`rs-agent-${agent.id}`} value={agent.user_id} />
                  <span className="text-sm font-medium">{agent.display_label}</span>
                </Label>
              ))}
            </RadioGroup>

            <Label
              htmlFor="rs-contacted"
              className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2.5 cursor-pointer dark:border-amber-900/50 dark:bg-amber-950/30"
            >
              <Checkbox
                id="rs-contacted"
                checked={contactedConfirmed}
                onCheckedChange={(v) => setContactedConfirmed(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">
                담당자에게 미리 연락했습니다. 지금 원격지원을 요청합니다.
              </span>
            </Label>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit || submitting || agents.length === 0}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            요청하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
