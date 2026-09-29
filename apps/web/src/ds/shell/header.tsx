import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

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

/**
 * Where a page's head is drawn: a slot in the shell, not the page itself
 * (Mika, 29.09.2026 — "the jumps between the main menu items"). Between two
 * sections the page under the head goes blank for a moment while its data
 * loads; drawn inside the page, the title went with it and came back, and on
 * a laptop it came back 51 px lower or higher as a section had tabs or not.
 * In the slot it keeps its line: on a laptop the head, then the section's
 * tabs, then the page; on a phone the tabs first, as before. While a page
 * loads and has no head yet, the slot holds the height of the last one, so
 * nothing under it moves up and back down.
 */
const SlotCtx = createContext<HTMLElement | null>(null);
export const usePageHeadSlot = () => useContext(SlotCtx);

export function PageHeadSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const last = useRef(0);
  useLayoutEffect(() => {
    const main = slot?.parentElement;
    if (!slot || !main) return;
    // Measured whenever it holds a head (when one arrives — before the browser
    // paints — and when one changes size). Emptied, it keeps that height only
    // while the page under it is still loading: a page that draws its own top
    // (Today, the wizards) gets no borrowed gap above it.
    const measure = () => {
      if (slot.childElementCount > 0) last.current = slot.offsetHeight;
    };
    const update = () => {
      if (slot.childElementCount > 0) {
        slot.style.minHeight = '';
        measure();
        return;
      }
      const stage = main.querySelector(':scope > .tab-stage');
      const loading = !!stage && [...stage.children].every((c) => c.matches('.skeleton-wait, .skeleton'));
      slot.style.minHeight = loading ? `${last.current}px` : '';
    };
    const size = new ResizeObserver(measure);
    const content = new MutationObserver(update);
    size.observe(slot);
    content.observe(main, { childList: true, subtree: true });
    return () => {
      size.disconnect();
      content.disconnect();
    };
  }, [slot]);
  return (
    <SlotCtx.Provider value={slot}>
      <div ref={setSlot} className="page-head-slot" />
      {children}
    </SlotCtx.Provider>
  );
}

/** Called by PageHead: puts its title into the phone header while the page is on screen. */
export function useAnnounceHeader(title: ReactNode, sub: ReactNode | undefined): void {
  const { setHeader } = useContext(Ctx);
  useEffect(() => {
    setHeader({ title, sub });
  }, [setHeader, title, sub]);
  useEffect(() => () => setHeader(null), [setHeader]);
}
