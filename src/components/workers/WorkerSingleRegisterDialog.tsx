import { useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import JobTypeSelect from "@/components/JobTypeSelect";
import { foreignRosterTransferPrompt } from "@/lib/workerCompanyTransfer";
import {
  formatWorkerPhoneInput,
  registerOneWorker,
  workerLoginPreview,
} from "@/lib/registerOneWorker";

type CompanyOpt = { id: string; name: string };

export default function WorkerSingleRegisterDialog({
  projectId,
  companyId,
  companyName,
  companies = [],
  companyLocked = false,
  open,
  onClose,
  onDone,
}: {
  projectId: string;
  companyId: string;
  companyName: string;
  companies?: CompanyOpt[];
  companyLocked?: boolean;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobType, setJobType] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [pickedCompanyId, setPickedCompanyId] = useState("");
  const [busy, setBusy] = useState(false);

  const effectiveCompanyId = companyId || pickedCompanyId;
  const effectiveCompanyName =
    companyName || companies.find((c) => c.id === effectiveCompanyId)?.name || "";
  const login = workerLoginPreview(phone);

  const reset = () => {
    setName("");
    setPhone("");
    setJobType("");
    setBirthDate("");
    setHireDate("");
    setPickedCompanyId("");
  };

  const submit = async () => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    if (!effectiveCompanyId) {
      toast.error("소속 회사를 선택하세요");
      return;
    }
    setBusy(true);
    try {
      let transferIfOtherCompany = false;
      for (;;) {
        const res = await registerOneWorker({
          projectId,
          companyId: effectiveCompanyId,
          companyName: effectiveCompanyName,
          name,
          phone,
          jobType,
          birthDate: birthDate || null,
          hireDate: hireDate || null,
          transferIfOtherCompany,
        });
        if (res.needsTransferConfirm && !transferIfOtherCompany) {
          const ok = window.confirm(
            foreignRosterTransferPrompt({
              name,
              source_company_name: res.needsTransferConfirm.sourceCompanyName,
              dest_company_name: effectiveCompanyName,
            }),
          );
          if (!ok) return;
          transferIfOtherCompany = true;
          continue;
        }
        if (!res.ok) throw new Error(res.error || "등록에 실패했습니다");
        const provision = res.provision;
        const provisionMsg = provision?.ok
          ? provision.created
            ? "로그인 계정을 만들었습니다"
            : provision.linked
              ? "기존 로그인 계정을 연결했습니다"
              : "명단에 반영했습니다"
          : `명단은 저장됐지만 계정 생성 실패: ${provision?.error || "unknown"}`;
        toast.success(`${name}님 등록 · ${provisionMsg}`, { duration: 7000 });
        toast.message("근로자 로그인", {
          description: `아이디=${login?.loginId || "전화번호"} · 비밀번호=전화 뒤 4자리${login ? ` (${login.password})` : ""}`,
          duration: 9000,
        });
        reset();
        onDone?.();
        onClose();
        return;
      }
    } catch (e: any) {
      toast.error(e?.message || "등록에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> 근로자 한 명 등록
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            전화번호를 넣으면 엑셀 일괄등록과 같이 로그인 계정이 자동으로 만들어집니다.
            아이디=전화번호, 비밀번호=전화 뒤 4자리.
          </p>
          {!companyId && companies.length > 0 && (
            <div className="space-y-1.5">
              <Label>소속사 *</Label>
              <Select
                value={pickedCompanyId}
                onValueChange={setPickedCompanyId}
                disabled={companyLocked || busy}
              >
                <SelectTrigger><SelectValue placeholder="소속사 선택" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {effectiveCompanyName && (
            <p className="text-xs">
              소속사 <span className="font-medium">{effectiveCompanyName}</span>
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="worker-one-name">이름 *</Label>
            <Input
              id="worker-one-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder="홍길동"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="worker-one-phone">전화번호 *</Label>
            <Input
              id="worker-one-phone"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(formatWorkerPhoneInput(e.target.value))}
              disabled={busy}
              placeholder="010-1234-5678"
            />
            {login && (
              <p className="text-[11px] text-muted-foreground">
                로그인 아이디 <span className="font-medium text-foreground">{login.loginId}</span>
                {" · "}비밀번호 <span className="font-medium text-foreground">{login.password}</span>
                (전화 뒤 4자리)
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>직종 *</Label>
            <JobTypeSelect value={jobType} onValueChange={setJobType} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="worker-one-birth">생년월일</Label>
              <Input
                id="worker-one-birth"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="worker-one-hire">입사일</Label>
              <Input
                id="worker-one-hire"
                type="date"
                value={hireDate}
                onChange={(e) => setHireDate(e.target.value)}
                disabled={busy}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} disabled={busy}>취소</Button>
            <Button onClick={() => void submit()} disabled={busy || !login}>
              {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              등록
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
