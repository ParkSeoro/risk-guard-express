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
 * Calendar and hour/minute sit side-by-side to keep popover short
 * (avoids stretching far below the trigger inside dialogs).
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

  useEffect(() => {
    if (open && !wasOpen.current) {
      const p = parseDateTimeValue(value);
      setDraftDate(p || new Date());
      setHour(p ? format(p, "HH") : "09");
      setMinute(p ? snapMinute(p.getMinutes()) : "00");
    }
    wasOpen.current = open;
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const scrollSelected = (root: HTMLDivElement | null, selected: string) => {
      const el = root?.querySelector(`[data-value="${selected}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: "center" });
    };
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
        className="w-auto p-2 z-[100]"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={12}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
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
        {/* Side-by-side: calendar | time — keeps height ~calendar only */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <Calendar
            mode="single"
            required
            selected={draftDate}
            onSelect={(d) => {
              if (d) setDraftDate(d);
            }}
            locale={ko}
            className="p-1"
          />
          <div className="flex flex-col gap-2 border-t pt-2 sm:border-t-0 sm:border-l sm:pl-2 sm:pt-0">
            <div className="flex items-stretch gap-1.5">
              <div className="flex flex-col gap-0.5">
                <span className="px-1 text-[10px] text-muted-foreground">시</span>
                <div
                  ref={hourListRef}
                  role="listbox"
                  aria-label="시"
                  className="h-[200px] w-[52px] overflow-y-auto rounded-md border border-input bg-background"
                >
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      role="option"
                      data-value={h}
                      aria-selected={hour === h}
                      className={cn(
                        "flex w-full items-center justify-center px-1 py-1 text-xs hover:bg-accent",
                        hour === h && "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                      onClick={() => setHour(h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="px-1 text-[10px] text-muted-foreground">분</span>
                <div
                  ref={minuteListRef}
                  role="listbox"
                  aria-label="분"
                  className="h-[200px] w-[52px] overflow-y-auto rounded-md border border-input bg-background"
                >
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      data-value={m}
                      aria-selected={minute === m}
                      className={cn(
                        "flex w-full items-center justify-center px-1 py-1 text-xs hover:bg-accent",
                        minute === m && "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                      onClick={() => setMinute(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-md bg-muted/50 px-2 py-1.5 text-center text-sm font-medium tabular-nums">
              {hour}:{minute}
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 flex-1 px-2 text-xs"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                지우기
              </Button>
              <Button type="button" size="sm" className="h-8 flex-1 px-2 text-xs" onClick={confirm}>
                확인
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
