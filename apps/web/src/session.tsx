import { DEFAULT_LOCALE, type Permission, type Role } from '@ev8/shared';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, SIGNED_OUT_EVENT, api } from './api.js';
import { useLocale } from './i18n/index.js';
import { onReconnect } from './lib/connection.js';

export interface Me {
  id: string;
  name: string;
  /** Empty for a mechanic who signs in only with a PIN (ADR-0033). */
  email: string | null;
  role: Role;
  permissions: Permission[];
  locale: string;
  orgTz: string;
  /** A PIN on the workshop tablet: repairs only, signed out after `idleMinutes` (ADR-0033 §7). */
  via: 'password' | 'pin';
  idleMinutes: number | null;
}

/**
 * What a person left on a shared device: the drafts a wizard keeps for its
 * author (ev8-draft:*) and the recent searches. They go with the session —
 * on the showroom phone and on the workshop tablet alike (ADR-0033 §9).
 */
export function forgetDeviceLeftovers(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('ev8-draft:') || key === 'ev8-recent') localStorage.removeItem(key);
  } catch {
    /* private mode: nothing was stored */
  }
}

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  /**
   * The session ended on the server while this screen was open (expired,
   * signed out elsewhere, password changed). The page stays where it is, with
   * what was typed, and the sign-in comes over it (wave 1 §3.8).
   */
  ended: { email: string | null } | null;
  /** Signed out here while the server could not be reached (QA-1-01): the login screen says so once. */
  signedOutOffline: boolean;
  dismissOffline: () => void;
  /**
   * Who is signed in could not be asked: the server was out of reach when the
   * app opened. That is not a sign-out — the app waits for the server rather
   * than show a login nobody can complete offline.
   */
  unreachable: boolean;
}

const Ctx = createContext<SessionCtx>(null as unknown as SessionCtx);

/**
 * Set when this device signed out but could not tell the server. While it is
 * set the app treats the device as signed out whatever the cookie still
 * opens, and asks the server again whenever the connection comes back.
 */
const PENDING_SIGN_OUT = 'ev8-signed-out';

function pendingSignOut(): boolean {
  try {
    return localStorage.getItem(PENDING_SIGN_OUT) === '1';
  } catch {
    return false;
  }
}
function setPendingSignOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(PENDING_SIGN_OUT, '1');
    else localStorage.removeItem(PENDING_SIGN_OUT);
  } catch {
    /* no storage: the server call is the only sign-out there is */
  }
}

/** Tell the server; true when the session is gone there (closed now, or already). */
async function closeOnServer(): Promise<boolean> {
  try {
    await api.post('/api/auth/logout');
    return true;
  } catch (e) {
    return e instanceof ApiError && e.status === 401;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [ended, setEnded] = useState<{ email: string | null } | null>(null);
  const { setLocale } = useLocale();
  const [signedOutOffline, setSignedOutOffline] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;

  const refresh = useCallback(async () => {
    try {
      if (pendingSignOut()) {
        if (await closeOnServer()) setPendingSignOut(false);
        setMe(null);
        return;
      }
      setMe(await api.get<Me>('/api/me'));
      setEnded(null);
      setUnreachable(false);
    } catch (e) {
      setMe(null);
      setUnreachable(!(e instanceof ApiError && e.status < 500));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The sign-out this device could not deliver is delivered when the connection returns.
  useEffect(
    () =>
      onReconnect(() => {
        if (pendingSignOut()) void closeOnServer().then((closed) => closed && setPendingSignOut(false));
        else if (!meRef.current) void refresh();
      }),
    [refresh],
  );

  useEffect(() => {
    // One refused request is a reason to ask, not proof: an API that is
    // restarting answers 401 for a moment before it can read sessions again,
    // and a live session must not be sent to type its password. The session
    // is over only when "who am I" itself says so.
    const check = () => {
      api
        .get<Me>('/api/me')
        .then((m) => {
          setMe(m);
          setEnded(null);
        })
        .catch((e) => {
          if (!(e instanceof ApiError && e.status === 401)) return;
          // Someone was working here: keep their screen, sign in over it.
          const was = meRef.current;
          // Not on the workshop tablet: the next mechanic must not find the
          // last one's screen, drafts or language (ADR-0033 §9).
          if (was?.via === 'pin') {
            forgetDeviceLeftovers();
            setLocale(DEFAULT_LOCALE);
            setMe(null);
          } else if (was) setEnded({ email: was.email });
          else setMe(null);
        });
    };
    window.addEventListener(SIGNED_OUT_EVENT, check);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, check);
  }, []);

  const logout = useCallback(async () => {
    // A phone at the showroom is shared: whatever a wizard kept on this
    // device for its author goes with the session (drafts are ev8-draft:*).
    forgetDeviceLeftovers();
    // The workshop tablet goes back to Georgian for whoever comes next.
    if (meRef.current?.via === 'pin') setLocale(DEFAULT_LOCALE);
    // The device forgets the session first, then tells the server — and if the
    // server cannot be reached, keeps telling it until it can (QA-1-01).
    setPendingSignOut(true);
    setMe(null);
    setEnded(null);
    if (await closeOnServer()) setPendingSignOut(false);
    else setSignedOutOffline(true);
  }, [setLocale]);

  const can = useCallback((p: Permission) => !!me && me.permissions.includes(p), [me]);

  return (
    <Ctx.Provider value={{ me, loading, refresh, logout, can, ended, signedOutOffline, dismissOffline: () => setSignedOutOffline(false), unreachable }}>
      {children}
    </Ctx.Provider>
  );
}

export const useSession = () => useContext(Ctx);
