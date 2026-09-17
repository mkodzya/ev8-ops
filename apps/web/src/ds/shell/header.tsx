import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * What the phone header says. On a phone the page's own title moves up into
 * the 56 px header (wave 1 §3.2), so a page announces it here; the laptop
 * keeps it where it is. One announcement at a time: the last page mounted.
 */
export interface HeaderTitle {
  title: ReactNode;
  sub?: ReactNode;
}

interface HeaderCtx {
  header: HeaderTitle | null;
  setHeader: (h: HeaderTitle | null) => void;
}

const Ctx = createContext<HeaderCtx>({ header: null, setHeader: () => {} });

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [header, setHeader] = useState<HeaderTitle | null>(null);
  return <Ctx.Provider value={{ header, setHeader }}>{children}</Ctx.Provider>;
}

export const useHeader = () => useContext(Ctx).header;

/** Called by PageHead: puts its title into the phone header while the page is on screen. */
export function useAnnounceHeader(title: ReactNode, sub: ReactNode | undefined): void {
  const { setHeader } = useContext(Ctx);
  useEffect(() => {
    setHeader({ title, sub });
  }, [setHeader, title, sub]);
  useEffect(() => () => setHeader(null), [setHeader]);
}
