import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
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
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_BOOT_SAFETY_MS = 8_000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesReady, setRolesReady] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const bootstrappedRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase.from("profiles").select("*").eq("user_id", userId).maybeSingle();
    if (error) {
      console.error("Error fetching profile:", error);
      setProfile(null);
      return null;
    }
    setProfile(data);
    return data;
  }, []);

  const fetchRoles = useCallback(async (userId: string): Promise<AppRole[]> => {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (error) {
      console.error("Error fetching roles:", error);
      setRoles([]);
      return [];
    }
    const next = (data?.map((r) => r.role) || []) as AppRole[];
    setRoles(next);
    return next;
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

      if (!nextSession?.user) {
        setProfile(null);
        setRoles([]);
        finishAuthLoading();
        return;
      }

      try {
        await Promise.all([fetchProfile(nextSession.user.id), fetchRoles(nextSession.user.id)]);
      } catch (e) {
        console.error("Auth hydrate failed:", e);
        setProfile(null);
        setRoles([]);
      } finally {
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
      // Login / logout / user update — rehydrate without flipping isAuthLoading back to true
      // (except we keep rolesReady honest during role refetch)
      void (async () => {
        if (event === "SIGNED_OUT") {
          setSession(null);
          setUser(null);
          setProfile(null);
          setRoles([]);
          setRolesReady(true);
          setIsAuthLoading(false);
          return;
        }
        setRolesReady(false);
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
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setRolesReady(true);
    setIsAuthLoading(false);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const applyProfilePatch = useCallback((patch: Partial<Profile>) => {
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const reloadAuthProfile = useCallback(async (): Promise<Profile | null> => {
    if (!user) return null;
    const [p] = await Promise.all([fetchProfile(user.id), fetchRoles(user.id)]);
    setRolesReady(true);
    return p;
  }, [user, fetchProfile, fetchRoles]);

  const hasRole = (role: AppRole) => roles.includes(role);
  const isAdmin = hasRole("admin") || hasRole("owner") || hasRole("pm") || hasRole("cm") || hasRole("sm");
  const isManager = isAdmin || hasRole("manager") || hasRole("hq") || hasRole("partner_manager");
  const isWorker = hasRole("worker") || hasRole("partner_worker");

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        loading: isAuthLoading,
        isAuthLoading,
        rolesReady,
        roles,
        hasRole,
        isAdmin,
        isManager,
        isWorker,
        signOut,
        refreshProfile,
        applyProfilePatch,
        reloadAuthProfile,
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
