import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { masterProcesses, masterPPE, masterLegalBasis, masterDepartments, masterAssignees } from "@/data/mockData";
import { Plus, Pencil, Trash2 } from "lucide-react";

const MasterData = () => {
  return (
    <div className="space-y-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">기준정보 관리</h1>
        <p className="text-sm text-muted-foreground mt-1">드롭다운 및 자동완성에 사용되는 마스터 데이터</p>
      </div>

      <Tabs defaultValue="processes">
        <TabsList>
          <TabsTrigger value="processes">공정 목록</TabsTrigger>
          <TabsTrigger value="ppe">PPE 목록</TabsTrigger>
          <TabsTrigger value="legal">법적근거</TabsTrigger>
          <TabsTrigger value="departments">부서·담당자</TabsTrigger>
        </TabsList>

        <TabsContent value="processes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">공정 목록</CardTitle>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> 추가
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>공정명</th><th>분류</th><th className="w-20 text-center">작업</th></tr></thead>
                <tbody>
                  {masterProcesses.map(p => (
                    <tr key={p.id}>
                      <td className="font-medium">{p.name}</td>
                      <td><Badge variant="secondary" className="text-[10px]">{p.category}</Badge></td>
                      <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6"><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ppe">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">PPE (개인보호구) 목록</CardTitle>
              <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> 추가</Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>보호구명</th><th className="w-20 text-center">작업</th></tr></thead>
                <tbody>
                  {masterPPE.map(p => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6"><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legal">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">법적근거 목록</CardTitle>
              <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> 추가</Button>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full data-table text-sm">
                <thead><tr><th>법령코드</th><th>설명</th><th className="w-20 text-center">작업</th></tr></thead>
                <tbody>
                  {masterLegalBasis.map(l => (
                    <tr key={l.id}>
                      <td className="font-medium whitespace-nowrap">{l.code}</td>
                      <td>{l.description}</td>
                      <td className="text-center">
                        <Button variant="ghost" size="icon" className="h-6 w-6"><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"><Trash2 className="h-3 w-3" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="departments">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">부서</CardTitle>
                <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> 추가</Button>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full data-table text-sm">
                  <thead><tr><th>부서명</th><th className="w-20 text-center">작업</th></tr></thead>
                  <tbody>
                    {masterDepartments.map(d => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.name}</td>
                        <td className="text-center">
                          <Button variant="ghost" size="icon" className="h-6 w-6"><Pencil className="h-3 w-3" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-base">담당자</CardTitle>
                <Button size="sm" variant="outline" className="gap-1.5"><Plus className="h-3.5 w-3.5" /> 추가</Button>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full data-table text-sm">
                  <thead><tr><th>이름</th><th>부서</th><th>직위</th><th>연락처</th></tr></thead>
                  <tbody>
                    {masterAssignees.map(a => {
                      const dept = masterDepartments.find(d => d.id === a.departmentId);
                      return (
                        <tr key={a.id}>
                          <td className="font-medium">{a.name}</td>
                          <td><Badge variant="secondary" className="text-[10px]">{dept?.name}</Badge></td>
                          <td>{a.position}</td>
                          <td className="text-muted-foreground">{a.phone}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MasterData;
