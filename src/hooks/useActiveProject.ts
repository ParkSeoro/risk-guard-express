import { useCallback, useEffect, useState } from "react";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  isActiveProjectStorageKey,
  readActiveProjectId,
  writeActiveProjectId,
} from "@/lib/activeProject";

/** Same-tab + cross-tab view of the active project (F-07). */
export function useActiveProject(): {
  projectId: string;
  setProjectId: (id: string) => void;
} {
  const [projectId, setState] = useState(() => readActiveProjectId());

  useEffect(() => {
    const sync = () => setState(readActiveProjectId());
    const onStorage = (e: StorageEvent) => {
      if (isActiveProjectStorageKey(e.key) || e.key == null) sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, sync);
    };
  }, []);

  const setProjectId = useCallback((id: string) => {
    writeActiveProjectId(id);
    setState(id || "");
  }, []);

  return { projectId, setProjectId };
}
