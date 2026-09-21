import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    profile: null,
    signOut: async () => undefined,
    hasRole: () => false,
    roles: [],
  }),
}));
vi.mock("@/components/AppLayout", () => ({
  useGlobalProjectAccessOptional: () => null,
}));
vi.mock("@/hooks/usePendingApprovalsCount", () => ({
  usePendingApprovalsCount: () => 0,
}));

import { sidebarMenuTitles } from "@/components/AppSidebar";
import { MANUAL_SIDEBAR_EXCEPTIONS, manualCorpusText } from "@/lib/manualContent";

describe("manual vs sidebar drift", () => {
  it("mentions every non-exception sidebar title", () => {
    const corpus = manualCorpusText();
    const missing = sidebarMenuTitles().filter((title) => {
      if (MANUAL_SIDEBAR_EXCEPTIONS.includes(title)) return false;
      return !corpus.includes(title);
    });
    expect(missing).toEqual([]);
  });
});
