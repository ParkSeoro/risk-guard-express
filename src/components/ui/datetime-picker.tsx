import { useEffect, useMemo, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { ko } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Stored as datetime-local style: YYYY-MM-DDTHH:mm */
const VALUE_FMT = "yyyy-MM-dd'T'HH:mm";
const DISPLAY_FMT = "yyyy-MM-dd HH:mm";

function parseValue(value?: string): Date | null {
  if (!value?.trim()) return null;
  const raw = value.trim();
  const local = parse(raw.slice(0, 16), VALUE_FMT, new Date());
  if (isValid(local)) return local;
  const iso = new Date(raw);
  return isValid(iso) ? iso : null;
}

function toValue(d: Date, hour: string, minute: string): string {
  const next = new Date(d);
  next.setHours(Number(hour), Number(minute), 0, 0);
  return format(next, VALUE_FMT);
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

export function DateTimePicker({
  value,
  onChange,
  placeholder = "날짜·시간 선택",
  disabled,
  className,
  compact,
}: Props) {
  const parsed = useMemo(() => parseValue(value), [value]);
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState<Date | undefined>(parsed || undefined);
  const [hour, setHour] = useState(parsed ? format(parsed, "HH") : "09");
  const [minute, setMinute] = useState(() => {
    if (!parsed) return "00";
    const m = parsed.getMinutes();
    const snapped = Math.round(m / 5) * 5;
    return String(snapped === 60 ? 55 : snapped).padStart(2, "0");
  });

  useEffect(() => {
    if (!open) return;
    const p = parseValue(value);
    // Empty value: default to today so Confirm is usable (today styling ≠ selected).
    setDraftDate(p || new Date());
    setHour(p ? format(p, "HH") : "09");
    if (p) {
      const m = p.getMinutes();
      const snapped = Math.round(m / 5) * 5;
      setMinute(String(snapped === 60 ? 55 : snapped).padStart(2, "0"));
    } else {
      setMinute("00");
    }
  }, [open, value]);

  const label = parsed ? format(parsed, DISPLAY_FMT) : placeholder;

  const confirm = () => {
    const day = draftDate || new Date();
    onChange(toValue(day, hour, minute));
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
          // Keep open when interacting with nested Select portals
          const t = e.target as HTMLElement | null;
          if (t?.closest('[data-radix-select-content], [role="listbox"]')) {
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
          initialFocus
        />
        <div className="mt-3 flex items-center gap-2 border-t pt-3">
          <Select value={hour} onValueChange={setHour}>
            <SelectTrigger className="w-[76px] h-9">
              <SelectValue placeholder="시" />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {HOURS.map((h) => (
                <SelectItem key={h} value={h}>{h}시</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select value={minute} onValueChange={setMinute}>
            <SelectTrigger className="w-[76px] h-9">
              <SelectValue placeholder="분" />
            </SelectTrigger>
            <SelectContent className="max-h-56">
              {MINUTES.map((m) => (
                <SelectItem key={m} value={m}>{m}분</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            type="button"
            variant="ghost"
            className="flex-1"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            지우기
          </Button>
          <Button type="button" className="flex-1" onClick={confirm}>
            확인
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
