import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ManageCamera = {
  id: string;
  name: string;
  camera_id?: string;
  playback_url?: string | null;
  health_state?: string | null;
  company_id?: string | null;
};

export type ManageCompanyOption = { id: string; name: string };

export type ManageCameraSave = { name: string; playback_url: string; company_id: string | null };

type Props = {
  cameras: ManageCamera[];
  companies?: ManageCompanyOption[];
  onSave: (cam: ManageCamera, next: ManageCameraSave) => Promise<void>;
  onDelete: (cam: ManageCamera) => Promise<void>;
  onRevealIngest?: (cam: ManageCamera) => Promise<void>;
};

export default function VisionCameraManageList({ cameras, companies, onSave, onDelete, onRevealIngest }: Props) {
  if (cameras.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2 text-sm" data-testid="vision-camera-manage">
      {cameras.map((cam) => (
        <CameraEditRow
          key={cam.id}
          cam={cam}
          companies={companies}
          onSave={onSave}
          onDelete={onDelete}
          onRevealIngest={onRevealIngest}
        />
      ))}
    </ul>
  );
}

function CameraEditRow({
  cam,
  companies,
  onSave,
  onDelete,
  onRevealIngest,
}: {
  cam: ManageCamera;
  companies?: ManageCompanyOption[];
  onSave: Props["onSave"];
  onDelete: Props["onDelete"];
  onRevealIngest?: Props["onRevealIngest"];
}) {
  const [name, setName] = useState(cam.name);
  const [url, setUrl] = useState(cam.playback_url || "");
  const [companyId, setCompanyId] = useState(cam.company_id || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(cam, { name: name.trim(), playback_url: url.trim(), company_id: companyId || null });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`${cam.name} 카메라를 삭제할까요?`)) return;
    setBusy(true);
    try {
      await onDelete(cam);
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!onRevealIngest) return;
    setBusy(true);
    try {
      await onRevealIngest(cam);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-2 border-t pt-2 md:grid-cols-[1fr_1.2fr_0.9fr_auto_auto_auto]">
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" aria-label="카메라 이름" />
      <select
        value={companyId}
        onChange={(e) => setCompanyId(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
        aria-label="소속 회사"
      >
        <option value="">현장 공용</option>
        {(companies || []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="재생 주소"
        className="h-8 text-sm"
        aria-label="재생 주소"
      />
      <Button type="button" size="sm" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => void save()}>
        수정
      </Button>
      {onRevealIngest && (
        <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => void reveal()}>
          송출
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy} onClick={() => void remove()}>
        삭제
      </Button>
    </li>
  );
}
