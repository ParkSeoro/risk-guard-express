import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { resetProjectViewingSession } from "@/lib/activeProject";
import type { Tables } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/permissions";

export type Profile = Tables<"profiles">;

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  /** @deprecated use isAuthLoading */
  loading: boolean;
  /** Session + profile + roles bootstrap in progress (single global gate). */
  isAuthLoading: boolean;
  /** True once roles have been fetched at least once for the current session. */
  rolesReady: boolean;
  /** True once the profile fetch for this session has settled (row or miss). */
  profileReady: boolean;
  roles: AppRole[];
  hasRole: (role: AppRole) => boolean;
  isAdmin: boolean;
  isManager: boolean;
  isWorker: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Optimistic local profile patch (e.g. after consent DB write). No network. */
  applyProfilePatch: (patch: Partial<Profile>) => void;
  /** Re-fetch profile + roles from DB and update context (awaits completion). */
  reloadAuthProfile: () => Promise<Profile | null>;
  /** Error message if profile or roles bootstrap failed */
  authError: string | null;
  /** Clear error and retry bootstrap */
  retryAuthBootstrap: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_BOOT_SAFETY_MS = 8_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesReady, setRolesReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
      if (error) {
        console.error("Error fetching profile:", error);
        setAuthError(error.message || "Failed to load profile");
        setProfile(null);
        return null;
      }
      setProfile(data);
      return data;
    } catch (err: any) {
      console.error("Exception fetching profile:", err);
      setAuthError(err?.message || "Failed to load profile");
      setProfile(null);
      return null;
    }
  }, []);

  const fetchRoles = useCallback(async (userId: string): Promise<AppRole[]> => {
    try {
      // Global roles (user_roles) are usually only `master`.
      // Partner/company admins live in project_members.role_new — must load both.
      const [globalRes, memberRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("project_members").select("role_new").eq("user_id", userId),
      ]);
      if (globalRes.error) {
        console.error("Error fetching user_roles:", globalRes.error);
        setAuthError((prev) => prev || globalRes.error.message);
      }
      if (memberRes.error) {
        console.error("Error fetching project_members roles:", memberRes.error);
        setAuthError((prev) => prev || memberRes.error.message);
      }
      const merged = new Set<string>();
      for (const r of globalRes.data || []) {
        if (r.role) merged.add(String(r.role));
      }
      for (const r of memberRes.data || []) {
        if (r.role_new) merged.add(String(r.role_new));
      }
      const next = Array.from(merged) as AppRole[];
      setRoles(next);
      return next;
    } catch (err: any) {
      console.error("Exception fetching roles:", err);
      setAuthError((prev) => prev || err?.message || "Failed to load roles");
      setRoles([]);
      return [];
    }
  }, []);

  const finishAuthLoading = useCallback(() => {
    setRolesReady(true);
    setIsAuthLoading(false);
  }, []);

  /** Load profile + roles for a session. Only the initial boot clears isAuthLoading. */
  const hydrateUser = useCallback(
    async (nextSession: Session | null, opts?: { isInitialBoot?: boolean }) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      userIdRef.current = nextSession?.user?.id ?? null;

      if (!nextSession?.user) {
        setProfile(null);
        setRoles([]);
        setProfileReady(true);
        setAuthError(null);
        finishAuthLoading();
        return;
      }

      setProfileReady(false);
      try {
        const [loadedProfile] = await Promise.all([
          fetchProfile(nextSession.user.id),
          fetchRoles(nextSession.user.id),
        ]);
        if (!loadedProfile) {
          setAuthError((prev) => prev || "계정 프로필 정보를 조회할 수 없습니다.");
        }
      } catch (e: any) {
        console.error("Auth hydrate failed:", e);
        setAuthError(e?.message || "Auth hydrate failed");
        setProfile(null);
        setRoles([]);
      } finally {
        setProfileReady(true);
        if (opts?.isInitialBoot) {
          finishAuthLoading();
        } else {
          setRolesReady(true);
        }
      }
    },
    [fetchProfile, fetchRoles, finishAuthLoading],
  );

  useEffect(() => {
    let cancelled = false;
    const safety = window.setTimeout(() => {
      if (!cancelled) {
        console.warn("[AuthProvider] bootstrap safety timeout — forcing isAuthLoading=false");
        finishAuthLoading();
      }
    }, AUTH_BOOT_SAFETY_MS);

    const runInitialBoot = async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (cancelled) return;
        bootstrappedRef.current = true;
        await hydrateUser(s, { isInitialBoot: true });
      } catch (e) {
        console.error("Initial auth boot failed:", e);
        if (!cancelled) finishAuthLoading();
      } finally {
        window.clearTimeout(safety);
      }
    };

    void runInitialBoot();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // INITIAL_SESSION is covered by getSession() above — skip to avoid double-fetch races.
      if (event === "INITIAL_SESSION") return;
      if (event === "TOKEN_REFRESHED") {
        setSession(nextSession);
        return;
      }
      // Login / logout / user update — rehydrate without flipping isAuthLoading back to true.
      // Same-user SIGNED_IN (second tab/iframe sharing storage) must not clear rolesReady —
      // that unmounts the admin tree and looks like a flicker loop.
      void (async () => {
        if (event === "SIGNED_OUT") {
          userIdRef.current = null;
          setSession(null);
          setUser(null);
          setProfile(null);
          setRoles([]);
          setRolesReady(true);
          setProfileReady(true);
          setIsAuthLoading(false);
          return;
        }
        const nextId = nextSession?.user?.id ?? null;
        const sameUser = !!(nextId && userIdRef.current && nextId === userIdRef.current);
        if (!sameUser) setRolesReady(false);
        await hydrateUser(nextSession, { isInitialBoot: false });
        setRolesReady(true);
      })();
    });

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn("Sign out error:", e);
    }
    resetProjectViewingSession();
    userIdRef.current = null;
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setRolesReady(true);
    setProfileReady(true);
    setAuthError(null);
    setIsAuthLoading(false);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const applyProfilePatch = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => {
      if (prev) return { ...prev, ...patch };
      // Avoid no-op when profile not yet hydrated — still merge so consent can clear
      return { ...(patch as Profile) };
    });
  }, []);

  const reloadAuthProfile = useCallback(async (): Promise<Profile | null> => {
    if (!user) return null;
    setAuthError(null);
    setProfileReady(false);
    try {
      const [p] = await Promise.all([fetchProfile(user.id), fetchRoles(user.id)]);
      if (!p) {
        setAuthError((prev) => prev || "계정 프로필 정보를 조회할 수 없습니다.");
      }
      setRolesReady(true);
      return p;
    } catch (e: any) {
      setAuthError(e?.message || "Failed to reload profile");
      return null;
    } finally {
      setProfileReady(true);
    }
  }, [user, fetchProfile, fetchRoles]);

  const retryAuthBootstrap = useCallback(async () => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      await hydrateUser(s, { isInitialBoot: true });
    } catch (e: any) {
      console.error("Retry auth bootstrap failed:", e);
      setAuthError(e?.message || "Retry failed");
      finishAuthLoading();
    }
  }, [hydrateUser, finishAuthLoading]);

  const hasRole = (role: AppRole) => roles.includes(role);
  // Shell-aware flags (match AuthGuard ADMIN_SHELL / WORKER_SHELL)
  const isAdmin =
    hasRole("master") ||
    hasRole("project_admin") ||
    hasRole("safety_manager") ||
    hasRole("site_manager") ||
    hasRole("supervisor") ||
    hasRole("site_supervisor") ||
    // legacy aliases (if any remain in old data)
    hasRole("admin") ||
    hasRole("owner") ||
    hasRole("pm") ||
    hasRole("cm") ||
    hasRole("sm");
  const isManager = isAdmin || hasRole("manager") || hasRole("hq") || hasRole("partner_manager");
  const isWorker =
    !isAdmin && (hasRole("worker") || hasRole("partner_worker") || hasRole("viewer"));

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading: isAuthLoading,
        isAuthLoading,
        rolesReady,
        profileReady,
        roles,
        hasRole,
        isAdmin,
        isManager,
        isWorker,
        signOut,
        refreshProfile,
        applyProfilePatch,
        reloadAuthProfile,
        authError,
        retryAuthBootstrap,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
