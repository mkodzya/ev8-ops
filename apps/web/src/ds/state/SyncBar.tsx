import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useT } from '../../i18n/index.js';
import { useConnection } from '../../lib/connection.js';
import './state.css';

// The reader's own clock on purpose, and the only place in the product that
// uses it: "данные на 09:12" answers "how long ago did I load this", which is
// a question about the person sitting here, not about the company's day
// (QA-W6-18).
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * The strip under the header (ux.md, "Нет связи"). While the server cannot be
 * reached it says so, and from what time the data on screen is. When the
 * connection comes back it says it refreshed, for three seconds, and goes.
 */
export function SyncBar() {
  const t = useT();
  const { online, backAt } = useConnection();
  const client = useQueryClient();
  const fetching = useIsFetching();
  const [showBack, setShowBack] = useState(false);

  useEffect(() => {
    if (!backAt) return;
    setShowBack(true);
    const timer = window.setTimeout(() => setShowBack(false), 3000);
    return () => window.clearTimeout(timer);
  }, [backAt]);

  if (!online) {
    // The time of the data this screen shows; a screen that never loaded has none to date (QA-W1 раунд 2).
    const newest = Math.max(0, ...client.getQueryCache().findAll({ type: 'active' }).map((q) => q.state.dataUpdatedAt));
    return <SyncStrip off text={newest ? t.sync.offlineSince(hhmm(newest)) : t.sync.offline} />;
  }
  if (showBack && backAt) return <SyncStrip text={t.sync.back(hhmm(backAt))} spinning={fetching > 0} />;
  return null;
}

/** The strip itself, without the connection behind it — for the design catalogue. */
export function SyncStrip({ off = false, text, spinning = false }: { off?: boolean; text: string; spinning?: boolean }) {
  return (
    <div className={`syncbar ${off ? 'syncbar-off' : 'syncbar-back'}`} role="status">
      {off ? (
        <CloudOff size={18} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <RefreshCw size={18} strokeWidth={1.75} aria-hidden="true" className={spinning ? 'spin' : undefined} />
      )}
      <span>{text}</span>
    </div>
  );
}
