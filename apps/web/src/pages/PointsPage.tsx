import { PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { PointsBlock } from './SettingsPage.js';

interface Fleet {
  vehicles: { state: string; location: { id: string } | null }[];
}

/** Fleet → Points, the owner's tab (wave 1 §3.2): the same list Settings keeps. */
export function PointsPage() {
  const t = useT();
  // A point's count answers "how many are here"; the rest of the fleet is at
  // customers or has no point at all, and those two make the sum add up (crit. 28).
  const fleet = useLoad<Fleet>('/api/fleet');
  const rows = fleet.data?.vehicles ?? [];
  const gone = (v: Fleet['vehicles'][number]) => v.state === 'sold' || v.state === 'out';
  const atCustomers = rows.filter((v) => v.state === 'rented').length;
  const noPoint = rows.filter((v) => !gone(v) && v.state !== 'rented' && !v.location).length;
  const sub = fleet.data ? `${t.vehicleW4.atCustomers(atCustomers)} · ${t.vehicleW4.noPoint(noPoint)}` : undefined;
  return (
    <>
      <PageHead title={t.shell.tabs.points} sub={sub} />
      <PointsBlock />
    </>
  );
}
