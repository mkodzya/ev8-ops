import { spellingMatches } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ModelDrawer } from '../components/ModelDrawer.js';
import { BlockHead, Loading, PageHead } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';

export type CostSource =
  | { kind: 'purchase'; purchaseId: string; number: string; receivedOn: string | null; preliminary: boolean; paidPercent: number }
  | { kind: 'odoo' }
  | { kind: 'manual' }
  | null;

export interface ModelRow {
  id: string;
  brand: string;
  name: string;
  salePriceTetri: number | null;
  weeklyRateTetri: number | null;
  costTetri: number | null;
  costSource: CostSource;
  photoUrl: string | null;
  notes: string | null;
  archived: boolean;
  vehicles: number;
  fleet: { rent: number; sale: number; none: number; gone: number };
  onOrder: number;
  orders: { id: string; number: string; qty: number }[];
}

export const unpriced = (m: Pick<ModelRow, 'salePriceTetri' | 'weeklyRateTetri'>) => m.salePriceTetri == null && m.weeklyRateTetri == null;

/** Where a model's unit cost came from, in a few words. */
export function CostFrom({ source, bare = false }: { source: CostSource; bare?: boolean }) {
  const t = useT();
  if (!source) return null;
  const words = source.kind === 'purchase' ? source.number : source.kind === 'odoo' ? t.models.fromOdoo : t.models.byHand;
  return bare ? <>{words}</> : <span className="muted"> · {words}</span>;
}

/** The mopeds of a model by park, naming only the parks that hold any. */
export function FleetLine({ fleet }: { fleet: ModelRow['fleet'] }) {
  const t = useT();
  const parts = (['rent', 'sale', 'none'] as const).filter((k) => fleet[k] > 0).map((k) => `${t.pools[k]} ${fleet[k]}`);
  return <>{parts.length ? parts.join(' · ') : t.common.dash}</>;
}

/**
 * The catalogue, one card per model: what renting and buying one costs, what
 * one cost us, and how many stand in each park. It answers "do we have it,
 * and at what price" without opening the fleet.
 */
export function ModelsPage() {
  const t = useT();
  const { can } = useSession();
  const navigate = useNavigate();
  const { data, failure, reload } = useLoad<{ models: ModelRow[] }>('/api/models?archived=1');
  const [adding, setAdding] = useState(false);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const active = data.models.filter((m) => !m.archived);
  const hidden = data.models.filter((m) => m.archived);
  const noPrice = active.filter(unpriced).length;
  const brands = [...new Set(active.map((m) => m.brand))].sort();
  const seeCost = can('cost.view');

  return (
    <>
      <PageHead title={t.models.title} sub={t.models.count(active.length)} note={noPrice > 0 ? t.models.unpricedCount(noPrice) : undefined}>
        {can('settings.manage') && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setAdding(true)}>
            + {t.models.add}
          </button>
        )}
      </PageHead>

      <DataList
        rows={active}
        rowKey={(m) => m.id}
        href={(m) => `/fleet/models/${m.id}`}
        fallback={(a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)}
        search={{ placeholder: t.lists.modelsSearch, match: (m, q) => spellingMatches(q, [m.brand, m.name, `${m.brand} ${m.name}`]) }}
        chips={[
          ...brands.map((b) => ({ key: `brand:${b}`, label: b, test: (m: ModelRow) => m.brand === b })),
          { key: 'unpriced', label: t.lists.chips.noPrices, test: unpriced },
        ]}
        empty={{ text: t.models.none }}
        card={(m) => ({
          title: m.name,
          sub: (
            <>
              {m.brand} · {t.lists.inFleet(m.vehicles)}
              {m.onOrder > 0 && <> · {t.lists.onOrder(m.onOrder)}</>}
            </>
          ),
          right: unpriced(m) ? (
            <span className="state state-service">{t.models.noPrices}</span>
          ) : (
            <span className="t-money">{m.weeklyRateTetri != null ? formatGel(m.weeklyRateTetri, { decimals: false }) : t.common.dash}</span>
          ),
          rightSub: seeCost
            ? m.costTetri != null
              ? `${t.models.costShort} ${formatGel(m.costTetri, { decimals: false })}`
              : undefined
            : m.salePriceTetri != null
              ? `${t.models.salePriceShort} ${formatGel(m.salePriceTetri, { decimals: false })}`
              : undefined,
        })}
        columns={[
          { key: 'brand', label: t.models.brand, cell: (m) => <span className="muted">{m.brand}</span>, sort: { value: (m) => m.brand } },
          {
            key: 'name',
            label: t.models.name,
            cell: (m) => (
              <>
                {m.name}
                {unpriced(m) && <span className="state state-service mcard-flag">{t.models.noPrices}</span>}
              </>
            ),
            sort: { value: (m) => m.name },
          },
          { key: 'rate', label: t.models.weeklyRateShort, num: true, cell: (m) => <span className="mono">{m.weeklyRateTetri != null ? formatGel(m.weeklyRateTetri, { decimals: false }) : t.common.dash}</span>, sort: { value: (m) => m.weeklyRateTetri, first: 'desc' } },
          { key: 'sale', label: t.models.salePriceShort, num: true, cell: (m) => <span className="mono">{m.salePriceTetri != null ? formatGel(m.salePriceTetri, { decimals: false }) : t.common.dash}</span>, sort: { value: (m) => m.salePriceTetri, first: 'desc' } },
          ...(seeCost
            ? [
                {
                  key: 'cost',
                  label: t.models.costShort,
                  num: true,
                  cell: (m: ModelRow) => (
                    <span className="mono">
                      {m.costTetri != null ? formatGel(m.costTetri) : t.common.dash}
                      {m.costTetri != null && <CostFrom source={m.costSource} />}
                    </span>
                  ),
                  sort: { value: (m: ModelRow) => m.costTetri, first: 'desc' as const },
                },
              ]
            : []),
          { key: 'fleet', label: t.models.inFleet, cell: (m) => <FleetLine fleet={m.fleet} />, sort: { value: (m) => m.vehicles, first: 'desc' } },
          {
            key: 'onOrder',
            label: t.models.onOrder,
            num: true,
            cell: (m) => (m.onOrder > 0 ? <span className="mono">{m.onOrder}</span> : <span className="muted">{t.common.dash}</span>),
            sort: { value: (m) => m.onOrder, first: 'desc' },
          },
        ]}
      />

      {hidden.length > 0 && (
        <section className="block-after">
          <BlockHead title={t.models.hidden} sub={t.models.count(hidden.length)} />
          <Cards models={hidden} />
        </section>
      )}

      {adding && (
        <ModelDrawer
          brands={data.models.map((m) => m.brand)}
          onClose={() => setAdding(false)}
          onSaved={(m) => {
            setAdding(false);
            reload();
            navigate(`/fleet/models/${m.id}`);
          }}
        />
      )}
    </>
  );
}

function Cards({ models }: { models: ModelRow[] }) {
  const t = useT();
  return (
    <div className="mcards">
      {models.map((m) => (
        <Link key={m.id} to={`/fleet/models/${m.id}`} className={`mcard ${m.archived ? 'mcard-hidden' : ''}`}>
          <span className="mcard-brand">{m.brand}</span>
          <span className="mcard-name">
            {m.name}
            {unpriced(m) && <span className="state state-service mcard-flag">{t.models.noPrices}</span>}
          </span>
          <span className="mcard-kv">
            <span>{t.models.weeklyRateShort}</span>
            <span className="mono">{m.weeklyRateTetri != null ? formatGel(m.weeklyRateTetri, { decimals: false }) : t.common.dash}</span>
          </span>
          <span className="mcard-kv">
            <span>{t.models.salePriceShort}</span>
            <span className="mono">{m.salePriceTetri != null ? formatGel(m.salePriceTetri, { decimals: false }) : t.common.dash}</span>
          </span>
          <span className="mcard-kv">
            <span>{t.models.costShort}</span>
            <span className="mono">{m.costTetri != null ? formatGel(m.costTetri) : t.common.dash}</span>
          </span>
          {/* Where the figure came from, under it: beside it, a card this
              narrow wraps the label or pushes the number out. */}
          {m.costTetri != null && m.costSource && (
            <span className="mcard-src">
              <CostFrom source={m.costSource} bare />
            </span>
          )}
          <span className="mcard-kv">
            <span>{t.models.inFleet}</span>
            <span>
              <FleetLine fleet={m.fleet} />
            </span>
          </span>
          {m.onOrder > 0 && (
            <span className="mcard-kv">
              <span>{t.models.onOrder}</span>
              <span>
                <span className="mono">{m.onOrder}</span>
                <span className="muted"> · {m.orders.map((o) => o.number).join(', ')}</span>
              </span>
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
