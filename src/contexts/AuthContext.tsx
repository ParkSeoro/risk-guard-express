import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
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
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
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
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (data) setProfile(data as Profile);
  };

  const KNOWN_ROLES = new Set([
    'master', 'project_admin', 'safety_manager', 'site_manager', 'supervisor',
    'site_supervisor', 'contractor', 'worker', 'viewer', 'user',
  ]);

  const normalizeRole = (role: string | null | undefined): AppRole | 'access_blocked' | null => {
    if (!role) return null;
    const r = role.toLowerCase();
    // 레거시 통칭 'contractor' / 'user' → worker (회사 타입 분기는 useProjectAccess에서)
    if (r === 'contractor' || r === 'user') return 'worker';
    if (KNOWN_ROLES.has(r)) return r as AppRole;
    // 알 수 없는 구형 값 → silent viewer 승격 금지, 명시적 차단 마커
    return 'access_blocked';
  };

  const fetchRoles = async (userId: string) => {
    const [{ data: systemRoles }, { data: projectRoles }] = await Promise.all([
      supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId),
      supabase
        .from('project_members')
        .select('role_new')
        .eq('user_id', userId),
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
  };


  const refreshProfile = async () => {
    if (user) {
      await Promise.all([fetchProfile(user.id), fetchRoles(user.id)]);
    }
  };

  const syncMasterAllowlist = async (userId: string) => {
    try {
      await supabase.rpc('ensure_master_allowlist', { _user_id: userId });
    } catch (e) {
      // non-critical – allowlist enforced server-side anyway
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        // Avoid full-app "로딩 중" flashes on token refresh / user update.
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setSession(session);
          if (session?.user) setUser(session.user);
          return;
        }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          // Process invite code if stored in user metadata (post-email-verification)
          const inviteCode = session.user.user_metadata?.invite_code;
          if (inviteCode) {
            try {
              await supabase.rpc('process_invite_code', {
                _user_id: session.user.id,
                _invite_code: inviteCode,
              });
              // Clear invite_code from metadata after processing
              await supabase.auth.updateUser({ data: { invite_code: null } });
            } catch (e) {
              // non-critical
            }
          }
          setTimeout(async () => {
            await syncMasterAllowlist(session.user.id);
            fetchProfile(session.user.id);
            fetchRoles(session.user.id);
          }, 0);
        } else if (event === 'SIGNED_OUT') {
          setProfile(null);
          setRoles([]);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await syncMasterAllowlist(session.user.id);
        fetchProfile(session.user.id);
        fetchRoles(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    try {
      // Clears localStorage-persisted session (and server refresh token when online)
      await supabase.auth.signOut();
    } catch {
      /* still force local clear below */
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    // Hard navigate so PWA/cold start cannot reuse stale in-memory auth; land on /login
    if (typeof window !== 'undefined') {
      window.location.assign('/login');
    }
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  const isAdmin = () => roles.includes('master') || roles.includes('project_admin') || roles.includes('safety_manager');

  return (
    <AuthContext.Provider value={{ user, session, profile, roles, loading, signOut, hasRole, isAdmin, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
