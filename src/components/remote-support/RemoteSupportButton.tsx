import { Headset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRemoteSupportOptional } from "@/components/remote-support/RemoteSupportHost";

export function RemoteSupportButton() {
  const rs = useRemoteSupportOptional();
  if (!rs?.canRequest) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground gap-1.5 px-2 h-8"
      onClick={() => rs.openRequestDialog()}
      title="원격지원 요청"
      aria-label="원격지원 요청"
    >
      <Headset className="h-4 w-4" />
      <span className="hidden md:inline text-xs">원격지원</span>
    </Button>
  );
}
