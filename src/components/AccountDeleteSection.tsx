import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface AccountDeleteSectionProps {
  compact?: boolean;
}

export function AccountDeleteSection({ compact = false }: AccountDeleteSectionProps) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canConfirm = confirmText.trim() === "계정 삭제" || confirmText.trim().toUpperCase() === "DELETE";

  const handleDelete = async () => {
    if (!canConfirm || deleting) return;
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("delete-my-account", {
        method: "POST",
      });
      if (error || !data?.ok) {
        toast.error(data?.error || error?.message || "계정 삭제에 실패했습니다.");
        return;
      }
      toast.success("계정이 삭제되었습니다.");
      setOpen(false);
      await signOut();
      navigate("/login", { replace: true });
    } catch (e: any) {
      toast.error(e?.message || "계정 삭제 중 오류가 발생했습니다.");
    } finally {
      setDeleting(false);
    }
  };

  const trigger = compact ? (
    <Button
      type="button"
      variant="ghost"
      className="w-full text-muted-foreground hover:text-destructive text-xs h-9"
      onClick={() => {
        setConfirmText("");
        setOpen(true);
      }}
    >
      <Trash2 className="h-3.5 w-3.5 mr-1.5" />
      계정 삭제 (회원 탈퇴)
    </Button>
  ) : (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-sm text-destructive flex items-center gap-1.5">
          <Trash2 className="h-4 w-4" />
          계정 삭제 (회원 탈퇴)
        </CardTitle>
        <CardDescription className="text-xs">
          로그인 계정 및 개인 연락처·알림 토큰을 영구 삭제합니다. 산업안전보건법상 보존이 필요한 작업허가·TBM 서명 및 성명 이력은 법정 기간 동안 보관됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={() => {
            setConfirmText("");
            setOpen(true);
          }}
        >
          계정 삭제 진행
        </Button>
      </CardContent>
    </Card>
  );

  return (
    <>
      {trigger}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive text-base">
              <AlertTriangle className="h-4 w-4" />
              계정을 영구 삭제하시겠습니까?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed pt-1">
              계정을 삭제하면 로그인 정보와 개인 연락처·푸시 알림 토큰이 즉시 삭제되며 복구할 수 없습니다.
              <br />
              단, 산업안전보건법에 따라 법적 보존 의무가 있는 작업허가서·TBM·안전점검 서명 및 성명 이력은 법정 기간 동안 그대로 보관됩니다.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <p className="text-xs font-medium">
              계속하려면 아래에 <span className="text-destructive font-bold">계정 삭제</span> 를 입력하세요.
            </p>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="계정 삭제"
              autoComplete="off"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!canConfirm || deleting}
              onClick={() => void handleDelete()}
            >
              {deleting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  삭제 중...
                </>
              ) : (
                "영구 삭제 확인"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
