import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { MUX_RTMP_SERVER, type VisionMuxIngest } from "@/lib/visionMux";

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  ingest: VisionMuxIngest | null;
  busy?: boolean;
  onCreate: () => Promise<void>;
};

async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("복사했습니다");
}

export default function VisionMuxSetup({ name, onNameChange, ingest, busy, onCreate }: Props) {
  const [copied, setCopied] = useState("");

  const copy = async (label: string, text: string) => {
    await copyText(text);
    setCopied(label);
  };

  return (
    <div className="mt-3 rounded-md border bg-muted/20 p-3 space-y-3" data-testid="vision-mux-setup">
      <p className="text-sm font-medium">클라우드 송출 · 카메라에 두 칸만 넣으면 됩니다</p>
      <ol className="list-decimal pl-5 text-xs text-muted-foreground space-y-1">
        <li>아래에서 카메라 이름을 넣고 추가합니다.</li>
        <li>
          나온 <span className="font-medium text-foreground">서버 주소</span>와{" "}
          <span className="font-medium text-foreground">스트림 키</span>를 VIGI 웹의 RTMP 칸에 붙여넣습니다.
        </li>
        <li>영상 코덱은 H.264 입니다. RTMPS가 아니라 RTMP 입니다.</li>
      </ol>
      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="카메라 이름"
          className="h-8 text-sm"
          aria-label="카메라 이름"
        />
        <Button size="sm" className="h-8" disabled={busy} onClick={() => void onCreate()}>
          추가
        </Button>
      </div>
      {ingest && (
        <div className="space-y-1" data-testid="vision-mux-ingest">
          <Row label="서버 주소" value={ingest.rtmp_url || MUX_RTMP_SERVER} onCopy={() => void copy("url", ingest.rtmp_url)} copied={copied === "url"} />
          <Row label="스트림 키" value={ingest.stream_key} onCopy={() => void copy("key", ingest.stream_key)} copied={copied === "key"} />
          <p className="text-[11px] text-muted-foreground">키는 이 화면에만 다시 볼 수 있습니다. 카메라에 바로 넣으세요.</p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  onCopy,
  copied,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0">{label}</span>
      <code className="flex-1 truncate bg-background border rounded px-2 py-1 font-mono">{value}</code>
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onCopy}>
        {copied ? "됨" : "복사"}
      </Button>
    </div>
  );
}
