import { useProjectAssigneePool } from '@/hooks/useProjectAssigneePool';
import IMESafeInput from '@/components/IMESafeInput';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { ChevronDown, User } from 'lucide-react';
import { useState, useMemo } from 'react';

interface Props {
  projectId: string;
  companyId?: string | null;
  /** display name to show / commit */
  value: string;
  onChange: (next: { name: string; userId?: string | null }) => void;
  placeholder?: string;
  className?: string;
  /** when true, only show people with a system account */
  requireUser?: boolean;
}

/**
 * Hybrid assignee picker: free text input (IME-safe) + dropdown
 * populated from the unified project_assignee_pool view (company
 * managers + project members). Used everywhere a "담당자" / "주관자"
 * field needs to be entered so company-management entries flow into
 * every module automatically.
 */
export default function AssigneeSelect({
  projectId, companyId, value, onChange, placeholder, className, requireUser,
}: Props) {
  const { options } = useProjectAssigneePool({ projectId, companyId, requireUser });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.display_name.toLowerCase().includes(q) ||
      (o.position || '').toLowerCase().includes(q) ||
      (o.company_name || '').toLowerCase().includes(q)
    );
  }, [options, query]);

  return (
    <div className={`flex gap-1 ${className || ''}`}>
      <IMESafeInput
        defaultValue={value}
        onCommit={(v) => onChange({ name: v })}
        placeholder={placeholder || '담당자 이름'}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="icon" title="등록된 관리자에서 선택">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="end">
          <div className="p-2 border-b">
            <input
              autoFocus
              className="w-full h-8 px-2 text-sm rounded border bg-background"
              placeholder="이름·직책·회사 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="max-h-64 overflow-auto">
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">
                등록된 담당자가 없습니다. <br />회사 관리 메뉴의 조직도에서 먼저 등록하세요.
              </div>
            ) : filtered.map(o => (
              <button
                key={o.key}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-start gap-2"
                onClick={() => {
                  onChange({ name: o.display_name, userId: o.user_id });
                  setOpen(false);
                }}
              >
                <User className="h-3 w-3 mt-0.5 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{o.display_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[o.company_name, o.position].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
