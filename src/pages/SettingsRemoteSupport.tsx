import { useEffect, useState } from "react";
import { Headset, Loader2, Plus, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchAllAgents,
  searchProfilesForAgent,
  setRemoteSupportAgentActive,
  upsertRemoteSupportAgent,
  type RemoteSupportAgent,
} from "@/lib/remoteSupport";
import { toast } from "sonner";

const SettingsRemoteSupport = () => {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [agents, setAgents] = useState<RemoteSupportAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Array<{ user_id: string; display_name: string | null }>>([]);
  const [searching, setSearching] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setAgents(await fetchAllAgents());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "담당자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isMaster) {
      setLoading(false);
      return;
    }
    void reload();
  }, [isMaster]);

  if (!isMaster) {
    return <p className="text-sm text-muted-foreground">마스터만 원격지원 담당자를 지정할 수 있습니다.</p>;
  }

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Headset className="h-6 w-6" /> 원격지원 담당자
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          현장 사용자의 원격지원 요청을 받을 시스템 담당자를 지정합니다. 시드가 비어 있으면 여기서 추가하세요.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">현재 담당자</CardTitle>
          <CardDescription>비활성하면 요청 목록에 나오지 않습니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중…
            </div>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">지정된 담당자가 없습니다. 아래에서 이름으로 검색해 추가하세요.</p>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{agent.display_label}</p>
                  <p className="text-[11px] text-muted-foreground">
                    순서 {agent.sort_order} · {agent.active ? "활성" : "비활성"}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={async () => {
                    try {
                      await setRemoteSupportAgentActive(agent.id, !agent.active);
                      toast.success(agent.active ? "비활성화했습니다." : "활성화했습니다.");
                      void reload();
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : "변경 실패");
                    }
                  }}
                >
                  {agent.active ? (
                    <>
                      <ToggleRight className="h-4 w-4" /> 끄기
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="h-4 w-4" /> 켜기
                    </>
                  )}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" /> 이름으로 추가
          </CardTitle>
          <CardDescription>표시 이름으로 검색한 뒤 담당자로 지정합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="예: 박서로"
              className="h-9"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void (async () => {
                    setSearching(true);
                    try {
                      setHits(await searchProfilesForAgent(query));
                    } catch (err: unknown) {
                      toast.error(err instanceof Error ? err.message : "검색 실패");
                    } finally {
                      setSearching(false);
                    }
                  })();
                }
              }}
            />
            <Button
              type="button"
              disabled={searching || !query.trim()}
              onClick={async () => {
                setSearching(true);
                try {
                  setHits(await searchProfilesForAgent(query));
                } catch (err: unknown) {
                  toast.error(err instanceof Error ? err.message : "검색 실패");
                } finally {
                  setSearching(false);
                }
              }}
            >
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "검색"}
            </Button>
          </div>
          {hits.map((hit) => (
            <div key={hit.user_id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
              <span className="text-sm">{hit.display_name || hit.user_id}</span>
              <Button
                type="button"
                size="sm"
                className="gap-1"
                onClick={async () => {
                  try {
                    await upsertRemoteSupportAgent({
                      userId: hit.user_id,
                      displayLabel: hit.display_name || "담당자",
                      sortOrder: agents.length + 1,
                      active: true,
                    });
                    toast.success("담당자로 지정했습니다.");
                    setHits([]);
                    setQuery("");
                    void reload();
                  } catch (err: unknown) {
                    toast.error(err instanceof Error ? err.message : "지정 실패");
                  }
                }}
              >
                <Plus className="h-4 w-4" /> 지정
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsRemoteSupport;
