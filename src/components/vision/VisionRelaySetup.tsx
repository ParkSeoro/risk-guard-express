import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  VISION_RELAY_SLOTS,
  visionRelayBase,
  visionRelayPlaybackUrl,
  visionRelayPublishUrl,
  visionRelaySlotLabel,
} from "@/lib/visionFleetApi";

type Props = {
  onCreateSlots: (slots: Array<{ camera_id: string; name: string; playback_url: string }>) => Promise<void>;
};

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("복사했습니다");
}

export default function VisionRelaySetup({ onCreateSlots }: Props) {
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const base = visionRelayBase(raw);

  const fill = async () => {
    if (!base) {
      toast.error("메모장의 SafeNex URL을 그대로 붙여넣으세요");
      return;
    }
    const slots = VISION_RELAY_SLOTS.map((camera_id, i) => {
      const playback_url = visionRelayPlaybackUrl(base, camera_id);
      return {
        camera_id,
        name: visionRelaySlotLabel(i),
        playback_url: playback_url || "",
      };
    });
    if (slots.some((s) => !s.playback_url)) {
      toast.error("중계주소가 올바르지 않습니다");
      return;
    }
    setBusy(true);
    try {
      await onCreateSlots(slots);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3" data-testid="vision-relay-setup">
      <p className="text-sm font-medium">영상 켜기 · 세 번만 하면 됩니다</p>
      <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-1">
        <li>
          컴퓨터에 Docker Desktop을 켠 뒤, 폴더 <span className="font-mono">vision-relay</span> 안의{" "}
          <span className="font-medium text-foreground">start.cmd</span> 를 더블클릭합니다. 메모장이 열리면 성공입니다.
        </li>
        <li>
          메모장 <span className="font-mono">relay-urls.txt</span> 의{" "}
          <span className="font-medium text-foreground">SafeNex URL</span> 한 줄을 아래에 붙여넣습니다.
        </li>
        <li>
          <span className="font-medium text-foreground">4칸 만들기</span>를 누른 다음, 아래 RTMP 주소를 카메라 RTMP란에
          한 대씩 붙여넣고 영상 코덱은 H.264로 둡니다.
        </li>
      </ol>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <Input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="예: http://123.45.67.89:8888"
          className="h-8 text-sm"
          data-testid="vision-relay-base"
        />
        <Button size="sm" className="h-8" disabled={busy} onClick={() => void fill()}>
          4칸 만들기
        </Button>
      </div>
      {base && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">카메라 RTMP에 붙여넣을 주소 · 코덱 H.264</p>
          {VISION_RELAY_SLOTS.map((slot, i) => {
            const rtmp = visionRelayPublishUrl(base, slot);
            return (
              <div key={slot} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0">{visionRelaySlotLabel(i)}</span>
                <code className="flex-1 truncate bg-background border rounded px-2 py-1 font-mono">{rtmp}</code>
                {rtmp && (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void copyText(rtmp)}>
                    복사
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
