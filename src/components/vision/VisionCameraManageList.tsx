import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ManageCamera = {
  id: string;
  name: string;
  playback_url?: string | null;
  health_state?: string | null;
};

type Props = {
  cameras: ManageCamera[];
  onSave: (cam: ManageCamera, next: { name: string; playback_url: string }) => Promise<void>;
  onDelete: (cam: ManageCamera) => Promise<void>;
};

export default function VisionCameraManageList({ cameras, onSave, onDelete }: Props) {
  if (cameras.length === 0) return null;
  return (
    <ul className="mt-3 space-y-2 text-sm" data-testid="vision-camera-manage">
      {cameras.map((cam) => (
        <CameraEditRow key={cam.id} cam={cam} onSave={onSave} onDelete={onDelete} />
      ))}
    </ul>
  );
}

function CameraEditRow({
  cam,
  onSave,
  onDelete,
}: {
  cam: ManageCamera;
  onSave: Props["onSave"];
  onDelete: Props["onDelete"];
}) {
  const [name, setName] = useState(cam.name);
  const [url, setUrl] = useState(cam.playback_url || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(cam, { name: name.trim(), playback_url: url.trim() });
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

  return (
    <li className="grid gap-2 border-t pt-2 md:grid-cols-[1fr_1.4fr_auto_auto]">
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" aria-label="카메라 이름" />
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
      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={busy} onClick={() => void remove()}>
        삭제
      </Button>
    </li>
  );
}
