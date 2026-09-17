import type { Permission, Role } from '@ev8/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api.js';

export interface Me {
  id: string;
  name: string;
  email: string;
  role: Role;
  permissions: Permission[];
  locale: string;
  orgTz: string;
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<SessionCtx>(null as unknown as SessionCtx);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      // A phone at the showroom is shared: whatever a wizard kept on this
      // device for its author goes with the session (drafts are ev8-draft:*).
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith('ev8-draft:')) localStorage.removeItem(key);
      } catch {
        /* private mode: nothing was stored */
      }
      setMe(null);
    }
  }, []);

  const can = useCallback((p: Permission) => !!me && me.permissions.includes(p), [me]);

  return <Ctx.Provider value={{ me, loading, refresh, logout, can }}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);
