import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import VisionLivePane from "@/components/vision/VisionLivePane";
import { VISION_CAMERA_SLOTS, visionCameraSlots, visionQuadPageCount } from "@/lib/visionFleetApi";

export type QuadCamera = {
  id: string;
  camera_id: string;
  name: string;
  health_state: string | null;
  playback_url?: string | null;
};

type Props = {
  cameras: QuadCamera[];
  page: number;
  onPageChange: (page: number) => void;
};

export default function VisionQuadGrid({ cameras, page, onPageChange }: Props) {
  const pageCount = visionQuadPageCount(cameras.length);
  const safePage = Math.min(page, pageCount - 1);
  const slots = visionCameraSlots(cameras, safePage);
  const from = cameras.length === 0 ? 0 : safePage * VISION_CAMERA_SLOTS + 1;
  const to = Math.min(cameras.length, (safePage + 1) * VISION_CAMERA_SLOTS);

  return (
    <div className="space-y-3" data-testid="vision-quad-grid">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">고화질 4화면</p>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground" data-testid="vision-quad-range">
            {cameras.length === 0 ? "슬롯 대기" : `${from}–${to} / ${cameras.length}대`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            disabled={safePage <= 0}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="이전 4화면"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            disabled={safePage >= pageCount - 1}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="다음 4화면"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {slots.map((cam, idx) => (
          <VisionLivePane
            key={cam?.id || `slot-${idx}`}
            index={idx}
            name={cam?.name}
            cameraId={cam?.camera_id}
            healthState={cam?.health_state}
            playbackUrl={cam?.playback_url}
          />
        ))}
      </div>
    </div>
  );
}
