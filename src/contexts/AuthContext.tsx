import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

type AppRole = 'master' | 'project_admin' | 'safety_manager' | 'site_manager' | 'supervisor' | 'site_supervisor' | 'contractor' | 'worker' | 'viewer' | 'user' | 'access_blocked';

interface Profile {
  id: string;
  user_id: string;
  display_name: string;
  phone: string;
  company: string;
  position: string;
  agreed_to_terms?: boolean | null;
  agreed_to_location?: boolean | null;
  agreed_to_privacy?: boolean | null;
  agreed_to_admin_security?: boolean | null;
  consent_agreed_at?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  rolesReady: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  hasRole: (role: AppRole) => boolean;
  isAdmin: () => boolean;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [rolesReady, setRolesReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const metaGen = useRef(0);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('[Auth] fetchProfile', error.message);
        return;
      }
      if (data) setProfile(data as Profile);
    } catch (e) {
      console.warn('[Auth] fetchProfile threw', e);
    }
  };

  const KNOWN_ROLES = new Set([
    'master', 'project_admin', 'safety_manager', 'site_manager', 'supervisor',
    'site_supervisor', 'contractor', 'worker', 'viewer', 'user',
  ]);

  const normalizeRole = (role: string | null | undefined): AppRole | 'access_blocked' | null => {
    if (!role) return null;
    const r = role.toLowerCase();
    if (r === 'contractor' || r === 'user') return 'worker';
    if (KNOWN_ROLES.has(r)) return r as AppRole;
    return 'access_blocked';
  };

  const fetchRoles = async (userId: string) => {
    try {
      const [{ data: systemRoles }, { data: projectRoles }] = await Promise.all([
        supabase.from('user_roles').select('role').eq('user_id', userId),
        supabase.from('project_members').select('role_new').eq('user_id', userId),
      ]);

      const raw = [
        ...(systemRoles || []).map((r: any) => normalizeRole(r.role)),
        ...(projectRoles || []).map((m: any) => normalizeRole(m.role_new)),
      ].filter(Boolean) as AppRole[];

      const combined = raw.length === 0
        ? []
        : raw.every((v) => v === 'access_blocked')
          ? (['access_blocked'] as AppRole[])
          : raw.filter((v) => v !== 'access_blocked');

      setRoles(Array.from(new Set(combined)));
    } catch (e) {
      console.warn('[Auth] fetchRoles threw', e);
      setRoles([]);
    }
  };

  const syncMasterAllowlist = async (userId: string) => {
    try {
      await supabase.rpc('ensure_master_allowlist', { _user_id: userId });
    } catch {
      // non-critical
    }
  };

  const loadUserMeta = async (userId: string) => {
    const gen = ++metaGen.current;
    setRolesReady(false);
    try {
      await syncMasterAllowlist(userId);
      await Promise.all([fetchProfile(userId), fetchRoles(userId)]);
    } catch (e) {
      console.warn('[Auth] loadUserMeta failed', e);
    } finally {
      // Always release deadlock — even on fetch failure / abort
      if (gen === metaGen.current) {
        setRolesReady(true);
        setLoading(false);
      }
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    // Do NOT flip rolesReady=false here — that freezes ConsentPage after submit
    try {
      await Promise.all([fetchProfile(user.id), fetchRoles(user.id)]);
    } catch (e) {
      console.warn('[Auth] refreshProfile failed', e);
    } finally {
      setRolesReady(true);
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (cancelled) return;
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setSession(session);
          if (session?.user) setUser(session.user);
          return;
        }
        // Skip duplicate INITIAL_SESSION if getSession already handling — still safe with gen
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const inviteCode = session.user.user_metadata?.invite_code;
          if (inviteCode) {
            try {
              await supabase.rpc('process_invite_code', {
                _user_id: session.user.id,
                _invite_code: inviteCode,
              });
              await supabase.auth.updateUser({ data: { invite_code: null } });
            } catch {
              // non-critical
            }
          }
          await loadUserMeta(session.user.id);
        } else {
          setProfile(null);
          setRoles([]);
          setRolesReady(true);
          setLoading(false);
        }
      },
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      setSession(session);
      setUser(session?.user ?? null);
      try {
        if (session?.user) {
          await loadUserMeta(session.user.id);
        } else {
          setProfile(null);
          setRoles([]);
          setRolesReady(true);
        }
      } finally {
        setLoading(false);
      }
    });

    // Safety: never leave UI on "세션 확인 중…" more than 8s
    const safety = window.setTimeout(() => {
      setLoading(false);
      setRolesReady(true);
    }, 8000);

    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* force local clear */
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setRolesReady(true);
    setLoading(false);
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  const isAdmin = () =>
    roles.includes('master') ||
    roles.includes('project_admin') ||
    roles.includes('safety_manager') ||
    roles.includes('site_manager') ||
    roles.includes('supervisor') ||
    roles.includes('site_supervisor');

  return (
    <AuthContext.Provider
      value={{ user, session, profile, roles, rolesReady, loading, signOut, hasRole, isAdmin, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
