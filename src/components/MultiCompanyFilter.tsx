import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Building2, X } from 'lucide-react';

interface Company { id: string; name: string; type?: string | null; }

interface Props {
  projectId: string | null;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
}

/**
 * 다중 회사 필터 드롭다운 (A2).
 * 보건/점검/사고 등 회사 필터가 필요한 페이지에서 공통 사용.
 * RLS가 1차 게이트이며 이 컴포넌트는 가시 데이터 안에서 추가 필터링용.
 */
export default function MultiCompanyFilter({ projectId, value, onChange, label = '회사' }: Props) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!projectId) { setCompanies([]); return; }
      const { data } = await supabase
        .from('companies')
        .select('id, name, type')
        .eq('project_id', projectId)
        .order('name');
      if (!cancelled) setCompanies((data as Company[]) || []);
    };
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  };

  const selectedNames = value
    .map(id => companies.find(c => c.id === id)?.name)
    .filter(Boolean) as string[];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            <Building2 className="h-3.5 w-3.5" />
            {label} ({value.length || '전체'})
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-2 max-h-80 overflow-y-auto">
          {companies.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">회사가 없습니다.</div>
          ) : (
            <div className="space-y-1">
              {companies.map(c => (
                <label key={c.id} className="flex items-center gap-2 p-1 rounded hover:bg-muted cursor-pointer">
                  <Checkbox checked={value.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                  <span className="text-sm">{c.name}</span>
                  {c.type && <span className="text-xs text-muted-foreground">({c.type})</span>}
                </label>
              ))}
            </div>
          )}
          {value.length > 0 && (
            <Button variant="ghost" size="sm" className="w-full mt-2" onClick={() => onChange([])}>
              <X className="h-3 w-3 mr-1" /> 선택 해제
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {selectedNames.slice(0, 3).map(n => (
        <Badge key={n} variant="secondary">{n}</Badge>
      ))}
      {selectedNames.length > 3 && <Badge variant="outline">+{selectedNames.length - 3}</Badge>}
    </div>
  );
}
