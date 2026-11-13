import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type Rep = {
  id: string;
  worker_id: string | null;
  worker_name: string | null;
  method: string;
};

const METHOD_LABEL: Record<string, string> = {
  union: "과반수 노조의 대표",
  majority: "근로자 과반을 대표하는 사람",
  none: "아직 없음",
};

export function WorkerRepresentativeLine({
  projectId,
  companyId,
  companies = [],
  companiesReady = true,
  companyLocked = false,
  onCompanyChange,
  workers,
  canEdit,
  onChanged,
}: {
  projectId: string;
  companyId: string;
  companies?: { id: string; name: string }[];
  companiesReady?: boolean;
  companyLocked?: boolean;
  onCompanyChange?: (companyId: string) => void;
  workers: { id: string; name: string; company_id?: string | null }[];
  canEdit: boolean;
  onChanged?: (action: string, details: Record<string, unknown>) => void;
}) {
  const [rep, setRep] = useState<Rep | null>(null);
  const [workerId, setWorkerId] = useState("");
  const [method, setMethod] = useState("majority");

  const load = async () => {
    const { data } = await supabase
      .from("worker_representatives" as any)
      .select("id, worker_id, worker_name, method")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .is("ended_at", null)
      .maybeSingle();
    setRep((data as unknown as Rep) || null);
  };

  useEffect(() => {
    setWorkerId("");
    setRep(null);
    if (projectId && companyId) void load();
  }, [projectId, companyId]);

  const save = async () => {
    if (!companyId) {
      toast.error("회사를 고르세요.");
      return;
    }
    const next = workers.find((w) => w.id === workerId);
    if (method !== "none" && !next) {
      toast.error("명단에서 근로자대표를 고르세요.");
      return;
    }
    const previous = rep?.worker_name || "없음";
    const nextName = method === "none" ? "없음" : next?.name || "";
    if (rep?.worker_name && nextName !== rep.worker_name) {
      const ok = window.confirm(
        `근로자대표를 ${previous}에서 ${nextName}로 바꿉니다. 이미 승인된 위험성평가의 이름은 바뀌지 않습니다.`,
      );
      if (!ok) return;
    }
    if (rep?.id) {
      await supabase.from("worker_representatives" as any).update({ ended_at: new Date().toISOString() }).eq("id", rep.id);
    }
    const { error } = await supabase.from("worker_representatives" as any).insert({
      project_id: projectId,
      company_id: companyId,
      worker_id: method === "none" ? null : next?.id,
      worker_name: method === "none" ? null : nextName,
      method,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    onChanged?.("근로자대표 지정", { from: previous, to: nextName, method });
    toast.success(method === "none" ? "이 회사 근로자대표: 없음" : `이 회사 근로자대표: ${nextName}`);
    setWorkerId("");
    await load();
  };

  const roster = workers.filter((w) => !w.company_id || w.company_id === companyId);
  const label = rep?.worker_name
    ? `${rep.worker_name} · ${METHOD_LABEL[rep.method] || rep.method}`
    : "없음";
  const companyName = companies.find((c) => c.id === companyId)?.name || "";
  const showCompanySelect = !!onCompanyChange && !companyLocked && companies.length > 0;

  return (
    <div className="rounded-md border px-3 py-2 flex flex-wrap items-center gap-2 text-sm">
      {showCompanySelect && (
        <Select value={companyId || undefined} onValueChange={onCompanyChange}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="회사">
            <SelectValue placeholder="회사 선택" />
          </SelectTrigger>
          <SelectContent>
            {companies.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {companyLocked && companyName && <span className="text-muted-foreground">{companyName}</span>}
      {!companyId ? (
        <span className="text-muted-foreground">
          {!companiesReady
            ? "회사를 불러오는 중"
            : companies.length === 0
              ? "이 현장에 등록된 회사가 없습니다."
              : "회사를 고르면 근로자대표를 지정할 수 있습니다."}
        </span>
      ) : (
        <>
          <span className="font-medium">이 회사 근로자대표: {label}</span>
          {canEdit && (
            <>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="union">과반수 노조의 대표</SelectItem>
                  <SelectItem value="majority">근로자 과반을 대표하는 사람</SelectItem>
                  <SelectItem value="none">아직 없음</SelectItem>
                </SelectContent>
              </Select>
              {method !== "none" && (
                <Select value={workerId || undefined} onValueChange={setWorkerId}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="이름" /></SelectTrigger>
                  <SelectContent>
                    {roster.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => void save()}>
                지정
              </Button>
            </>
          )}
        </>
      )}
    </div>
  );
}
