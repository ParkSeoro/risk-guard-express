import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Search, Shield, Loader2 } from 'lucide-react';

interface AccidentCase {
  id: string;
  accident_type: string;
  process_category: string;
  equipment: string;
  cause: string;
  result: string;
  fatality: boolean;
  injury_count: number;
  location_type: string;
  description: string;
  prevention_measures: string[];
  risk_factors: string[];
}

interface Props {
  defaultProcess?: string;
  defaultEquipment?: string;
  onSelectRiskFactors?: (factors: string[], measures: string[]) => void;
}

export default function AccidentPrediction({ defaultProcess, defaultEquipment, onSelectRiskFactors }: Props) {
  const [process, setProcess] = useState(defaultProcess || '');
  const [equipment, setEquipment] = useState(defaultEquipment || '');
  const [results, setResults] = useState<AccidentCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!process && !equipment) return;
    setLoading(true);
    setSearched(true);

    try {
      let query = supabase.from('accident_cases').select('*');

      // Build keyword search
      const keywords: string[] = [];
      if (process) keywords.push(...process.split(/[\s,]+/).filter(Boolean));
      if (equipment) keywords.push(...equipment.split(/[\s,]+/).filter(Boolean));

      // Search by process_category or keywords
      if (process && equipment) {
        query = query.or(
          `process_category.ilike.%${process}%,equipment.ilike.%${equipment}%,keywords.cs.{${keywords.join(',')}}`
        );
      } else if (process) {
        query = query.or(`process_category.ilike.%${process}%,keywords.cs.{${process}}`);
      } else if (equipment) {
        query = query.or(`equipment.ilike.%${equipment}%,keywords.cs.{${equipment}}`);
      }

      const { data } = await query.limit(10);
      setResults((data as AccidentCase[]) || []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFactors = (item: AccidentCase) => {
    if (onSelectRiskFactors) {
      onSelectRiskFactors(item.risk_factors, item.prevention_measures);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-warning" />
          사고데이터 기반 위험 예측
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">공종</Label>
            <Input
              value={process}
              onChange={e => setProcess(e.target.value)}
              placeholder="예: 양중작업, 굴착작업"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <Label className="text-xs">장비</Label>
            <Input
              value={equipment}
              onChange={e => setEquipment(e.target.value)}
              placeholder="예: 크레인, 굴삭기"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <Button size="sm" onClick={handleSearch} disabled={loading || (!process && !equipment)} className="w-full h-8 text-xs gap-1">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          유사 사고 검색
        </Button>

        {searched && results.length === 0 && !loading && (
          <p className="text-xs text-muted-foreground text-center py-2">검색 결과가 없습니다.</p>
        )}

        {results.length > 0 && (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {results.map(item => (
              <div key={item.id} className="p-2.5 rounded-lg border bg-card space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant={item.fatality ? 'destructive' : 'outline'} className="text-[9px] h-4">
                    {item.accident_type}
                  </Badge>
                  <Badge variant="secondary" className="text-[9px] h-4">{item.process_category}</Badge>
                  {item.equipment && <Badge variant="outline" className="text-[9px] h-4">{item.equipment}</Badge>}
                  {item.fatality && <Badge variant="destructive" className="text-[9px] h-4">사망</Badge>}
                </div>
                <p className="text-xs font-medium">{item.cause}</p>
                <p className="text-[10px] text-muted-foreground">{item.description}</p>
                {item.risk_factors.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {item.risk_factors.map((f, i) => (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 bg-destructive/10 text-destructive rounded">{f}</span>
                    ))}
                  </div>
                )}
                {item.prevention_measures.length > 0 && (
                  <div className="text-[10px] text-muted-foreground">
                    <span className="font-medium">예방대책:</span> {item.prevention_measures.join(', ')}
                  </div>
                )}
                {onSelectRiskFactors && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] gap-1 w-full"
                    onClick={() => handleApplyFactors(item)}
                  >
                    <Shield className="h-3 w-3" /> 위험요인 적용
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
