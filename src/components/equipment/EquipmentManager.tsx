import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Wrench, Search } from 'lucide-react';
import { COMMON_CRANES } from '@/lib/workPlanTemplates';

interface Equipment {
  id?: string;
  project_id: string;
  company_id: string | null;
  name: string;
  rated_capacity: number | null;
  manufacturer: string;
  model_name: string;
  is_default: boolean;
}

interface Props {
  projectId: string;
  companyId?: string | null;
  onSelect?: (equipment: Equipment) => void;
  selectable?: boolean;
}

const DEFAULT_EQUIPMENT: Omit<Equipment, 'project_id' | 'company_id'>[] = COMMON_CRANES.map(c => ({
  name: c.model,
  rated_capacity: c.maxCapacity,
  manufacturer: '',
  model_name: c.model,
  is_default: true,
}));

export default function EquipmentManager({ projectId, companyId, onSelect, selectable }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [newItem, setNewItem] = useState({ name: '', rated_capacity: '', manufacturer: '', model_name: '' });

  const fetchEquipment = useCallback(async () => {
    const { data } = await supabase
      .from('equipment_master')
      .select('*')
      .eq('project_id', projectId)
      .order('is_default', { ascending: false })
      .order('name');
    
    if (data && data.length > 0) {
      setEquipment(data as Equipment[]);
    } else {
      // Seed defaults for this project
      const defaults = DEFAULT_EQUIPMENT.map(e => ({
        ...e,
        project_id: projectId,
        company_id: null,
        created_by: user?.id,
      }));
      const { data: inserted } = await supabase.from('equipment_master').insert(defaults).select();
      if (inserted) setEquipment(inserted as Equipment[]);
    }
    setLoading(false);
  }, [projectId, user]);

  useEffect(() => { fetchEquipment(); }, [fetchEquipment]);

  const handleAdd = async () => {
    if (!newItem.name.trim()) return;
    const { error } = await supabase.from('equipment_master').insert({
      project_id: projectId,
      company_id: companyId || null,
      name: newItem.name,
      rated_capacity: newItem.rated_capacity ? Number(newItem.rated_capacity) : null,
      manufacturer: newItem.manufacturer,
      model_name: newItem.model_name,
      is_default: false,
      created_by: user?.id,
    });
    if (!error) {
      toast({ title: '장비가 추가되었습니다.' });
      setNewItem({ name: '', rated_capacity: '', manufacturer: '', model_name: '' });
      setShowAdd(false);
      fetchEquipment();
    }
  };

  const handleDelete = async (id: string) => {
    await supabase.from('equipment_master').delete().eq('id', id);
    fetchEquipment();
  };

  const filtered = equipment.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.manufacturer.toLowerCase().includes(search.toLowerCase()) ||
    e.model_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="text-xs text-muted-foreground p-4">장비 로딩 중...</div>;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Wrench className="h-4 w-4" /> 장비 관리
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7" onClick={() => setShowAdd(true)}>
            <Plus className="h-3 w-3" /> 장비 추가
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            className="h-8 text-xs pl-8"
            placeholder="장비명, 제조사, 모델 검색..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Add form */}
        {showAdd && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-[10px]">장비명 *</Label>
                <Input className="h-7 text-xs" value={newItem.name} onChange={e => setNewItem(prev => ({ ...prev, name: e.target.value }))} placeholder="예: 50톤 크롤러크레인" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">정격하중 (톤)</Label>
                <Input className="h-7 text-xs" type="number" value={newItem.rated_capacity} onChange={e => setNewItem(prev => ({ ...prev, rated_capacity: e.target.value }))} placeholder="50" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">제조사</Label>
                <Input className="h-7 text-xs" value={newItem.manufacturer} onChange={e => setNewItem(prev => ({ ...prev, manufacturer: e.target.value }))} placeholder="예: 두산" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">모델명</Label>
                <Input className="h-7 text-xs" value={newItem.model_name} onChange={e => setNewItem(prev => ({ ...prev, model_name: e.target.value }))} placeholder="예: DX300" />
              </div>
            </div>
            <div className="flex gap-1.5 justify-end">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAdd(false)}>취소</Button>
              <Button size="sm" className="h-7 text-xs" onClick={handleAdd}>추가</Button>
            </div>
          </div>
        )}

        {/* List */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="border px-2 py-1.5 text-left font-medium">장비명</th>
                <th className="border px-2 py-1.5 text-left font-medium">정격하중</th>
                <th className="border px-2 py-1.5 text-left font-medium">제조사</th>
                <th className="border px-2 py-1.5 text-left font-medium">모델명</th>
                <th className="border px-2 py-1.5 text-center font-medium w-20">작업</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id || e.name} className="hover:bg-muted/30 cursor-pointer" onClick={() => selectable && onSelect?.(e)}>
                  <td className="border px-2 py-1">
                    <div className="flex items-center gap-1.5">
                      {e.name}
                      {e.is_default && <Badge variant="secondary" className="text-[9px] h-4">기본</Badge>}
                    </div>
                  </td>
                  <td className="border px-2 py-1">{e.rated_capacity ? `${e.rated_capacity}t` : '—'}</td>
                  <td className="border px-2 py-1 text-muted-foreground">{e.manufacturer || '—'}</td>
                  <td className="border px-2 py-1 text-muted-foreground">{e.model_name || '—'}</td>
                  <td className="border px-2 py-1 text-center">
                    {!e.is_default && e.id && (
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id!); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="border px-2 py-4 text-center text-muted-foreground">장비가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
