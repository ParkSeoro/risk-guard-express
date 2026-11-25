import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Check, Copy, Loader2, Smartphone } from "lucide-react";
import type { AttendanceImpactResult } from "@/lib/map/mapCalibrationSafety";

export function MobileWalkQrDialog({
  open,
  onOpenChange,
  mapName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined"
      ? `${window.location.origin}/app/worker/map-calibration`
      : "https://www.safenex.org/app/worker/map-calibration";

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore clipboard failures */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-emerald-600" />
            모바일 워킹 보정 QR
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            스마트폰 카메라로 스캔하면 <b>맵·GPS 맞추기</b> 화면이 바로 열립니다.
            {mapName ? ` (${mapName})` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <QRCodeSVG value={url} size={184} level="M" />
          </div>
          <ol className="text-[11px] text-muted-foreground space-y-1 w-full bg-muted/40 rounded-md p-2.5 leading-relaxed">
            <li>1. 현장 내 서로 떨어진 기준 지점 3곳(A·B·C)으로 이동합니다.</li>
            <li>2. 도면에서 내가 서 있는 지점을 탭하고 <b>GPS 측정</b>을 누릅니다.</li>
            <li>3. <b>워킹 보정 저장</b>을 누르면 비율 왜곡 없이 자동 정렬됩니다.</li>
          </ol>
          <div className="flex items-center gap-1.5 w-full">
            <Input value={url} readOnly className="h-8 text-[11px]" />
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void copyUrl()}>
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RenameSiteMapDialog({
  open,
  onOpenChange,
  initialName,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  saving: boolean;
  onConfirm: (nextName: string) => void;
}) {
  const [name, setName] = useState(initialName);
  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">도면 이름 변경</DialogTitle>
          <DialogDescription className="text-xs">
            공정 날짜나 구역명(예: 2026-11 드론정사 · 1공구)으로 구분하면 관리가 편합니다.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <Label className="text-xs">도면 이름</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: 2026-11 최신 드론사진"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && !saving) onConfirm(name.trim());
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={saving || !name.trim()}
            onClick={() => onConfirm(name.trim())}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteSiteMapDialog({
  open,
  onOpenChange,
  mapName,
  deleting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mapName: string;
  deleting: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>도면 「{mapName}」을(를) 삭제할까요?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed space-y-1.5">
            <span className="block">
              지난 공정 드론사진을 목록에서 안전하게 숨김(소프트 삭제) 처리합니다.
            </span>
            <span className="block font-medium text-emerald-700 dark:text-emerald-300">
              근로자 출퇴근 범위([2] GPS 개소)와 위험구역([3] 위험구역)은 삭제되지 않으며 그대로 유지됩니다.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>취소</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            도면 삭제
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function AttendanceImpactGuardDialog({
  open,
  onOpenChange,
  impact,
  actionLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impact: AttendanceImpactResult | null;
  actionLabel: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  if (!impact) return null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            출퇴근 차단 위험 경고
          </AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed space-y-2">
            <span className="block">
              이 변경을 적용하면 현재 출근 중인 근로자 <b>{impact.total}명</b> 중{" "}
              <b className="text-destructive">
                {impact.included}명 ({impact.inclusionPct}%)
              </b>
              만 출근 허용 구역 안에 포함됩니다.
            </span>
            <span className="block text-destructive font-medium">
              나머지 {impact.excluded}명의 근로자는 출퇴근이 막히거나 현장 이탈로 판정될 수 있습니다.
            </span>
            <span className="block">
              좌표나 개소 범위를 다시 확인한 뒤 진행하세요. 정말 그대로 {actionLabel}할까요?
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>취소하고 다시 확인</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            위험 감수하고 {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClearGpsCalibrationDialog({
  open,
  onOpenChange,
  offsetM,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offsetM: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>프로젝트 1점 GPS 보정(≈{offsetM}m)을 초기화할까요?</AlertDialogTitle>
          <AlertDialogDescription className="text-xs leading-relaxed space-y-1.5">
            <span className="block">
              이 보정은 프로젝트 전체 근로자의 GPS 표시·판정 좌표에 적용 중입니다.
            </span>
            <span className="block">
              도면을 모바일 워킹 보정으로 새로 맞췄거나 기존 보정이 잘못된 경우에만 초기화하세요.
              초기화 즉시 모든 기기의 보정 캐시가 갱신됩니다.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>유지하기</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
            1점 보정 초기화
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
