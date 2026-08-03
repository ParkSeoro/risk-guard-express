import { useEffect, useMemo, useRef, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Stored as datetime-local style: YYYY-MM-DDTHH:mm */
const VALUE_FMT = "yyyy-MM-dd'T'HH:mm";
const DISPLAY_FMT = "yyyy-MM-dd HH:mm";

export function parseDateTimeValue(value?: string): Date | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const local = parse(raw.slice(0, 16), VALUE_FMT, new Date());
  if (isValid(local)) return local;
  const iso = new Date(raw);
  return isValid(iso) ? iso : null;
}

export function toDateTimeValue(d: Date, hour: string, minute: string): string {
  const next = new Date(d);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return format(next, VALUE_FMT);
}

function snapMinute(m: number): string {
  const snapped = Math.round(m / 5) * 5;
  return String(snapped === 60 ? 55 : snapped).padStart(2, "0");
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

type Props = {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Compact look for table cells */
  compact?: boolean;
};

/**
 * Date + time picker.
 * Hour/minute are in-popover button lists (not native <select> / Radix Select)
 * so nested Dialogs do not dismiss when picking time.
 */
export function DateTimePicker({
  value,
  onChange,
  placeholder = "날짜·시간 선택",
  disabled,
  className,
  compact,
}: Props) {
  const parsed = useMemo(() => parseDateTimeValue(value), [value]);
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | undefined>(parsed || undefined);
  const [hour, setHour] = useState(parsed ? format(parsed, "HH") : "09");
  const [minute, setMinute] = useState(() => {
    if (!parsed) return "00";
    return snapMinute(parsed.getMinutes());
  });
  const wasOpen = useRef(false);
  const hourListRef = useRef<HTMLDivElement>(null);
  const minuteListRef = useRef<HTMLDivElement>(null);

  // Sync draft only when the popover opens — not on every value tick while open.
  useEffect(() => {
    if (open && !wasOpen.current) {
      const p = parseDateTimeValue(value);
      setDraftDate(p || new Date());
      setHour(p ? format(p, "HH") : "09");
      setMinute(p ? snapMinute(p.getMinutes()) : "00");
    }
    wasOpen.current = open;
  }, [open, value]);

  // Scroll selected hour/minute into view when opening
  useEffect(() => {
    if (!open) return;
    const scrollSelected = (root: HTMLDivElement | null, selected: string) => {
      const el = root?.querySelector(`[data-value="${selected}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "center" });
    };
    // rAF: list is mounted after open paint
    const id = requestAnimationFrame(() => {
      scrollSelected(hourListRef.current, hour);
      scrollSelected(minuteListRef.current, minute);
    });
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- only on open

  const label = parsed ? format(parsed, DISPLAY_FMT) : placeholder;

  const confirm = () => {
    const day = draftDate || new Date();
    onChange(toDateTimeValue(day, hour, minute));
    setOpen(false);
  };

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "justify-start text-left font-normal",
            compact ? "h-8 px-2 text-xs" : "h-10",
            !parsed && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className={cn("mr-2 shrink-0 opacity-70", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3 z-[100]"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          // Nested portals (rare) — keep open
          const t = e.target as HTMLElement | null;
          if (
            t?.closest(
              '[data-radix-select-content], [data-radix-popper-content-wrapper], [role="listbox"]',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <Calendar
          mode="single"
          required
          selected={draftDate}
          onSelect={(d) => {
            if (d) setDraftDate(d);
          }}
          locale={ko}
        />
        <div className="mt-3 flex items-stretch gap-2 border-t pt-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground px-1">시</span>
            <div
              ref={hourListRef}
              role="listbox"
              aria-label="시"
              className="h-36 w-[64px] overflow-y-auto rounded-md border border-input bg-background"
            >
              {HOURS.map((h) => (
                <button
                  key={h}
                  type="button"
                  role="option"
                  data-value={h}
                  aria-selected={hour === h}
                  className={cn(
                    "flex w-full items-center justify-center px-2 py-1.5 text-sm hover:bg-accent",
                    hour === h && "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                  onClick={() => setHour(h)}
                >
                  {h}시
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground px-1">분</span>
            <div
              ref={minuteListRef}
              role="listbox"
              aria-label="분"
              className="h-36 w-[64px] overflow-y-auto rounded-md border border-input bg-background"
            >
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="option"
                  data-value={m}
                  aria-selected={minute === m}
                  className={cn(
                    "flex w-full items-center justify-center px-2 py-1.5 text-sm hover:bg-accent",
                    minute === m && "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                  onClick={() => setMinute(m)}
                >
                  {m}분
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-2 pl-1">
            <div className="rounded-md bg-muted/50 px-2 py-2 text-center text-sm font-medium tabular-nums">
              {hour}:{minute}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              지우기
            </Button>
            <Button type="button" size="sm" onClick={confirm}>
              확인
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
