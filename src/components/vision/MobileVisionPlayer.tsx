import { useState } from "react";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import VisionLivePane from "@/components/vision/VisionLivePane";
import {
  selectedMobileVisionCamera,
  type MobileVisionCamera,
} from "@/lib/mobileVisionPlayer";

type Props = {
  cameras: MobileVisionCamera[];
};

export default function MobileVisionPlayer({ cameras }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedMobileVisionCamera(cameras, selectedId);

  return (
    <div className="space-y-3" data-testid="mobile-vision-player">
      <p className="text-sm font-medium">카메라 1대</p>
      {cameras.length > 0 && (
        <div
          className="flex gap-2 overflow-x-auto pb-0.5"
          data-testid="mobile-vision-camera-list"
        >
          {cameras.map((camera) => {
            const active = camera.id === selected?.id;
            return (
              <button
                key={camera.id}
                type="button"
                data-testid={`mobile-vision-cam-${camera.id}`}
                aria-pressed={active}
                className={cn(
                  "shrink-0 rounded-full border px-3 h-8 text-xs",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-foreground",
                )}
                onClick={() => setSelectedId(camera.id)}
              >
                {camera.name}
              </button>
            );
          })}
        </div>
      )}
      {selected ? (
        <VisionLivePane
          key={selected.id}
          index={0}
          name={selected.name}
          cameraId={selected.camera_id}
          healthState={selected.health_state}
          playbackUrl={selected.playback_url}
          waitingHint="송출 대기"
        />
      ) : (
        <div
          className="relative overflow-hidden rounded-md border bg-black min-h-[180px] aspect-video flex flex-col items-center justify-center gap-2 text-white/80"
          data-testid="mobile-vision-empty"
        >
          <WifiOff className="h-5 w-5" />
          <p className="text-sm font-medium">등록된 카메라가 없습니다</p>
          <p className="text-[11px] text-white/60">PC 비전 관제에서 추가합니다</p>
        </div>
      )}
    </div>
  );
}
