import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sampleRiskItems, masterProcesses, masterPPE, masterLegalBasis, masterDepartments, masterAssignees } from "@/data/mockData";
import { getRiskClassName, type RiskItem, type ImplementationStatus } from "@/types";
import { Plus, Download, Upload, Filter, Search, Copy, Trash2, Edit3 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const RiskAssessment = () => {
  const [items, setItems] = useState<RiskItem[]>(sampleRiskItems);
  const [filterProcess, setFilterProcess] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const { toast } = useToast();

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (filterProcess !== 'all' && item.process !== filterProcess) return false;
      if (filterStatus !== 'all' && item.status !== filterStatus) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        return item.hazard.toLowerCase().includes(term) ||
          item.subTask.toLowerCase().includes(term) ||
          item.process.toLowerCase().includes(term) ||
          item.hazardSituation.toLowerCase().includes(term);
      }
      return true;
    });
  }, [items, filterProcess, filterStatus, searchTerm]);

  const uniqueProcesses = [...new Set(items.map(i => i.process))];

  const handleCellEdit = (id: string, field: keyof RiskItem, value: any) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, [field]: value };
      if (field === 'frequency' || field === 'severity') {
        updated.risk = updated.frequency * updated.severity;
      }
      if (field === 'improvedFrequency' || field === 'improvedSeverity') {
        updated.improvedRisk = updated.improvedFrequency * updated.improvedSeverity;
      }
      if (field === 'department') {
        const dept = masterDepartments.find(d => d.name === value);
        if (dept) {
          const assignee = masterAssignees.find(a => a.departmentId === dept.id);
          if (assignee) updated.assignee = assignee.name;
        }
      }
      return updated;
    }));
    setEditingCell(null);
  };

  const handleDuplicate = (item: RiskItem) => {
    const newItem = { ...item, id: `r${Date.now()}`, status: '미착수' as ImplementationStatus };
    setItems(prev => [...prev, newItem]);
    toast({ title: "행이 복사되었습니다." });
  };

  const handleDelete = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
    toast({ title: "행이 삭제되었습니다." });
  };

  const handleAddNew = () => {
    const newItem: RiskItem = {
      id: `r${Date.now()}`,
      projectId: 'proj1',
      process: masterProcesses[0].name,
      subTask: '',
      hazard: '',
      hazardSituation: '',
      existingMeasure: '',
      improvementMeasure: '',
      frequency: 1,
      severity: 1,
      risk: 1,
      improvedFrequency: 1,
      improvedSeverity: 1,
      improvedRisk: 1,
      status: '미착수',
      ppe: [],
      legalBasis: [],
      department: masterDepartments[0].name,
      assignee: masterAssignees[0].name,
      note: '',
      attachments: [],
    };
    setItems(prev => [...prev, newItem]);
    setShowAddDialog(false);
    toast({ title: "새 항목이 추가되었습니다. 인라인으로 편집하세요." });
  };

  const EditableCell = ({ item, field, type = 'text' }: { item: RiskItem; field: keyof RiskItem; type?: string }) => {
    const isEditing = editingCell?.id === item.id && editingCell?.field === field;
    const value = item[field];

    if (isEditing) {
      if (field === 'status') {
        return (
          <Select defaultValue={value as string} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
            <SelectTrigger className="h-7 text-xs w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="미착수">미착수</SelectItem>
              <SelectItem value="진행">진행</SelectItem>
              <SelectItem value="완료">완료</SelectItem>
            </SelectContent>
          </Select>
        );
      }
      if (field === 'department') {
        return (
          <Select defaultValue={value as string} onValueChange={(v) => handleCellEdit(item.id, field, v)}>
            <SelectTrigger className="h-7 text-xs w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {masterDepartments.map(d => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      if (type === 'number') {
        return (
          <Input
            type="number"
            min={1} max={5}
            defaultValue={value as number}
            className="h-7 w-12 text-xs text-center"
            autoFocus
            onBlur={(e) => handleCellEdit(item.id, field, Number(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && handleCellEdit(item.id, field, Number((e.target as HTMLInputElement).value))}
          />
        );
      }
      return (
        <Input
          defaultValue={value as string}
          className="h-7 text-xs min-w-[100px]"
          autoFocus
          onBlur={(e) => handleCellEdit(item.id, field, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCellEdit(item.id, field, (e.target as HTMLInputElement).value)}
        />
      );
    }

    return (
      <span
        className="cursor-pointer hover:bg-accent/20 px-1 py-0.5 rounded transition-colors block min-h-[1.5em]"
        onClick={() => setEditingCell({ id: item.id, field })}
      >
        {String(value || '—')}
      </span>
    );
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">위험성평가</h1>
          <p className="text-sm text-muted-foreground mt-1">인라인 편집: 셀 클릭 → 수정 → Enter/외부 클릭으로 저장</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> CSV 업로드
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> XLSX 다운로드
          </Button>
          <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90" onClick={handleAddNew}>
            <Plus className="h-3.5 w-3.5" /> 행 추가
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Filter className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">필터</span>
            </div>
            <Select value={filterProcess} onValueChange={setFilterProcess}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue placeholder="공정 전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">공정 전체</SelectItem>
                {uniqueProcesses.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 w-28 text-xs">
                <SelectValue placeholder="상태 전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">상태 전체</SelectItem>
                <SelectItem value="미착수">미착수</SelectItem>
                <SelectItem value="진행">진행</SelectItem>
                <SelectItem value="완료">완료</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="위험요인, 작업명, 공정 검색..."
                className="h-8 pl-8 text-xs"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filteredItems.length}건
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Risk Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full data-table text-xs">
              <thead>
                <tr>
                  <th className="w-8 text-center">#</th>
                  <th>공정</th>
                  <th>세부작업</th>
                  <th>위험요인</th>
                  <th>위험발생상황</th>
                  <th>기존대책</th>
                  <th>개선대책</th>
                  <th className="text-center w-10">F</th>
                  <th className="text-center w-10">S</th>
                  <th className="text-center w-12">R</th>
                  <th className="text-center w-10">F'</th>
                  <th className="text-center w-10">S'</th>
                  <th className="text-center w-12">R'</th>
                  <th className="text-center w-16">상태</th>
                  <th>책임부서</th>
                  <th>담당자</th>
                  <th className="w-16 text-center">작업</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="text-center text-muted-foreground">{idx + 1}</td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="process" /></td>
                    <td className="editable"><EditableCell item={item} field="subTask" /></td>
                    <td className="editable"><EditableCell item={item} field="hazard" /></td>
                    <td className="editable max-w-[200px]"><EditableCell item={item} field="hazardSituation" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="existingMeasure" /></td>
                    <td className="editable max-w-[180px]"><EditableCell item={item} field="improvementMeasure" /></td>
                    <td className="text-center editable"><EditableCell item={item} field="frequency" type="number" /></td>
                    <td className="text-center editable"><EditableCell item={item} field="severity" type="number" /></td>
                    <td className="text-center">
                      <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getRiskClassName(item.risk)}`}>
                        {item.risk}
                      </span>
                    </td>
                    <td className="text-center editable"><EditableCell item={item} field="improvedFrequency" type="number" /></td>
                    <td className="text-center editable"><EditableCell item={item} field="improvedSeverity" type="number" /></td>
                    <td className="text-center">
                      <span className={`inline-flex items-center justify-center w-8 h-6 rounded text-[11px] font-bold ${getRiskClassName(item.improvedRisk)}`}>
                        {item.improvedRisk}
                      </span>
                    </td>
                    <td className="text-center editable"><EditableCell item={item} field="status" /></td>
                    <td className="editable whitespace-nowrap"><EditableCell item={item} field="department" /></td>
                    <td className="whitespace-nowrap text-muted-foreground">{item.assignee}</td>
                    <td className="text-center">
                      <div className="flex items-center gap-0.5 justify-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDuplicate(item)}>
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RiskAssessment;
