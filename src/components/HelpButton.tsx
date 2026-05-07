import { useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { HelpCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { findHelp } from "@/lib/helpDictionary";

/** 화면 우상단/헤더에 끼우는 ? 도움말 버튼 */
export function HelpButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const help = findHelp(pathname);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label="도움말"
          title="이 화면 도움말"
        >
          <HelpCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-primary" />
            {help ? help.title : "도움말"}
          </DialogTitle>
        </DialogHeader>
        {help ? (
          <div className="space-y-3 text-sm">
            <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
              {help.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            {help.tip && (
              <div className="rounded-md bg-accent/10 border border-accent/30 p-2 text-xs">
                💡 {help.tip}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">이 화면에 대한 도움말이 아직 등록되지 않았습니다.</p>
        )}
        <DialogFooter>
          <Link to="/manual" onClick={() => setOpen(false)}>
            <Button variant="outline" size="sm">
              <BookOpen className="h-4 w-4 mr-1" /> 전체 매뉴얼 열기
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
