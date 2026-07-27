import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import {
  assessRoleAccess,
  type CanonicalProjectRole,
} from '@/lib/legacyRoleMapping';

type AppRole = CanonicalProjectRole;

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
  /** 매핑 불가 레거시 권한만 있을 때 true — 앱 접근 차단용 */
  roleAccessBlocked: boolean;
  roleAccessBlockReason: string | null;
  unknownLegacyRoles: string[];
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
  const [roleAccessBlocked, setRoleAccessBlocked] = useState(false);
  const [roleAccessBlockReason, setRoleAccessBlockReason] = useState<string | null>(null);
  const [unknownLegacyRoles, setUnknownLegacyRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (data) setProfile(data as Profile);
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
      ...(systemRoles || []).map((r: any) => r.role as string),
      ...(projectRoles || []).map((m: any) => m.role_new as string),
    ];

    const assessment = assessRoleAccess(raw);
    setRoles(assessment.normalizedRoles);
    setUnknownLegacyRoles(assessment.unknownRaw);
    setRoleAccessBlocked(assessment.blocked);
    setRoleAccessBlockReason(assessment.blockReason);

    const legacyHits = raw.filter((r) => {
      const key = String(r || '').toLowerCase();
      return key === 'contractor' || key === 'user';
    });
    if (legacyHits.length > 0) {
      console.warn('[legacyRole] mapped legacy role aliases:', legacyHits);
    }
    if (assessment.unknownRaw.length > 0) {
      console.error('[legacyRole] unmapped roles:', assessment.unknownRaw);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await Promise.all([fetchProfile(user.id), fetchRoles(user.id)]);
    }
  };

  const syncMasterAllowlist = async (userId: string) => {
    try {
      await supabase.rpc('ensure_master_allowlist', { _user_id: userId });
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
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
          setTimeout(async () => {
            await syncMasterAllowlist(session.user.id);
            fetchProfile(session.user.id);
            fetchRoles(session.user.id);
          }, 0);
        } else {
          setProfile(null);
          setRoles([]);
          setRoleAccessBlocked(false);
          setRoleAccessBlockReason(null);
          setUnknownLegacyRoles([]);
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
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setProfile(null);
    setRoles([]);
    setRoleAccessBlocked(false);
    setRoleAccessBlockReason(null);
    setUnknownLegacyRoles([]);
  };

  const hasRole = (role: AppRole) => roles.includes(role);
  // worker←contractor 별칭 제거 후 정규화된 role 기준
  const isAdmin = () =>
    roles.includes('master') || roles.includes('project_admin') || roles.includes('safety_manager');

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        roles,
        roleAccessBlocked,
        roleAccessBlockReason,
        unknownLegacyRoles,
        loading,
        signOut,
        hasRole,
        isAdmin,
        refreshProfile,
      }}
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
