import { useEffect, useState } from "react";
import { Lock, ShieldCheck, Delete, KeyRound, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  disableMessengerLock,
  saveMessengerLockConfig,
  verifyMessengerPin,
  type MessengerAutoLockMinutes,
  type MessengerLockState,
} from "@/lib/messengerLock";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface MessengerLockScreenProps {
  userId: string;
  userName?: string | null;
  onUnlocked: () => void;
}

export function MessengerLockScreen({
  userId,
  userName,
  onUnlocked,
}: MessengerLockScreenProps) {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const submitPin = async (candidate: string) => {
    if (candidate.length !== 4 || verifying) return;
    setVerifying(true);
    try {
      const ok = await verifyMessengerPin(userId, candidate);
      if (ok) {
        setPin("");
        setErrorMsg(null);
        onUnlocked();
      } else {
        setPin("");
        setErrorMsg("비밀번호가 일치하지 않습니다.");
      }
    } finally {
      setVerifying(false);
    }
  };

  const appendDigit = (d: string) => {
    if (verifying) return;
    setErrorMsg(null);
    setPin((prev) => {
      if (prev.length >= 4) return prev;
      const next = prev + d;
      if (next.length === 4) {
        void submitPin(next);
      }
      return next;
    });
  };

  const backspace = () => {
    setErrorMsg(null);
    setPin((prev) => prev.slice(0, -1));
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        appendDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        backspace();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [userId, verifying]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/85 backdrop-blur-xl text-white p-6 select-none"
      role="dialog"
      aria-modal="true"
      aria-label="메신저 잠금 화면"
    >
      <div className="w-full max-w-[300px] flex flex-col items-center text-center">
        <div className="h-14 w-14 rounded-2xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center mb-4 shadow-lg">
          <Lock className="h-6 w-6 text-sky-300" />
        </div>
        <h2 className="text-base font-bold tracking-tight">SafeNex 메신저 잠금</h2>
        <p className="text-xs text-slate-300 mt-1">
          {userName ? `${userName}님, ` : ""}설정한 4자리 PIN을 입력해 잠금을 해제하세요.
        </p>

        {/* 4-dot PIN indicator */}
        <div className="flex items-center gap-3.5 my-6">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className={cn(
                "h-3.5 w-3.5 rounded-full border-2 transition-all duration-150",
                idx < pin.length
                  ? "bg-sky-400 border-sky-400 scale-110"
                  : "border-slate-500 bg-transparent",
              )}
            />
          ))}
        </div>

        <div className="h-5 mb-3">
          {errorMsg && <p className="text-xs text-rose-400 font-medium">{errorMsg}</p>}
        </div>

        {/* Numeric keypad */}
        <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
          {keys.map((k, idx) => {
            if (k === "") return <div key={idx} />;
            if (k === "back") {
              return (
                <button
                  key="back"
                  type="button"
                  onClick={backspace}
                  className="h-12 rounded-xl bg-white/5 hover:bg-white/15 active:scale-95 flex items-center justify-center text-slate-200 transition"
                  aria-label="지우기"
                >
                  <Delete className="h-5 w-5" />
                </button>
              );
            }
            return (
              <button
                key={k}
                type="button"
                onClick={() => appendDigit(k)}
                className="h-12 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 text-lg font-semibold text-white transition"
              >
                {k}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface MessengerLockSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  lockState: MessengerLockState;
  onSaved: (next: MessengerLockState) => void;
}

export function MessengerLockSettingsDialog({
  open,
  onOpenChange,
  userId,
  lockState,
  onSaved,
}: MessengerLockSettingsDialogProps) {
  const hasExistingPin = Boolean(lockState.pinHash);
  const [timeoutMinutes, setTimeoutMinutes] = useState<MessengerAutoLockMinutes>(
    lockState.timeoutMinutes || 5,
  );
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setTimeoutMinutes(lockState.timeoutMinutes || (hasExistingPin ? 0 : 5));
      setPin("");
      setConfirmPin("");
    }
  }, [open, lockState.timeoutMinutes, hasExistingPin]);

  const handleSave = async () => {
    if (!hasExistingPin && pin.length !== 4) {
      toast.error("4자리 숫자 PIN을 입력해 주세요.");
      return;
    }
    if (pin.length > 0) {
      if (!/^\d{4}$/.test(pin)) {
        toast.error("PIN은 숫자 4자리여야 합니다.");
        return;
      }
      if (pin !== confirmPin) {
        toast.error("PIN 확인 번호가 일치하지 않습니다.");
        return;
      }
    }
    setSaving(true);
    try {
      const next = await saveMessengerLockConfig(userId, {
        pin: pin.length === 4 ? pin : undefined,
        timeoutMinutes,
      });
      onSaved(next);
      toast.success("이 기기의 메신저 잠금 설정이 저장되었습니다.");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = () => {
    const next = disableMessengerLock(userId);
    onSaved(next);
    toast.success("이 기기의 메신저 잠금이 해제되었습니다.");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-primary" />
            메신저 잠금 설정 (이 기기)
          </DialogTitle>
          <DialogDescription className="text-xs">
            지정한 시간 동안 입력이 없으면 메신저가 자동으로 잠기며, 별도 4자리 PIN으로만 열립니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              자동 잠금 시간
            </Label>
            <Select
              value={String(timeoutMinutes)}
              onValueChange={(v) => setTimeoutMinutes(Number(v) as MessengerAutoLockMinutes)}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">수동 잠금만 사용 (자동 잠금 끔)</SelectItem>
                <SelectItem value="1">1분 후 자동 잠금</SelectItem>
                <SelectItem value="3">3분 후 자동 잠금</SelectItem>
                <SelectItem value="5">5분 후 자동 잠금</SelectItem>
                <SelectItem value="10">10분 후 자동 잠금</SelectItem>
                <SelectItem value="30">30분 후 자동 잠금</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="messenger-pin" className="text-xs flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              {hasExistingPin ? "새 4자리 PIN (변경 시에만 입력)" : "4자리 숫자 PIN 설정 *"}
            </Label>
            <Input
              id="messenger-pin"
              type="password"
              inputMode="numeric"
              maxLength={4}
              placeholder="숫자 4자리"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>

          {(pin.length > 0 || !hasExistingPin) && (
            <div className="space-y-1.5">
              <Label htmlFor="messenger-pin-confirm" className="text-xs">
                4자리 PIN 확인
              </Label>
              <Input
                id="messenger-pin-confirm"
                type="password"
                inputMode="numeric"
                maxLength={4}
                placeholder="동일한 숫자 4자리"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          {hasExistingPin ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={handleDisable}>
              잠금 사용 안 함
            </Button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              저장
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
