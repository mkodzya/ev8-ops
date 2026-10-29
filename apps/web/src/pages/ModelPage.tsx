import type { VehiclePool, VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { ModelDrawer } from '../components/ModelDrawer.js';
import { BlockHead, ColorText, Empty, Loading, PageHead, PlaceText, StateBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatForeign, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { rowClick } from '../lib/rowLink.js';
import { SortHead, useSortable } from '../lib/sortable.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { CostFrom, type ModelRow } from './ModelsPage.js';
import type { PurchaseStatus } from './PurchasesPage.js';

interface Card {
  model: ModelRow;
  vehicles: { id: string; vin: string; state: VehicleState; pool: VehiclePool | null; color: string | null; location: { id: string; name: string } | null }[];
  orders: {
    lineId: string;
    purchaseId: string;
    number: string;
    status: PurchaseStatus;
    orderedOn: string;
    receivedOn: string | null;
    currency: string;
    qty: number;
    unitPriceMinor: number;
    unitCostTetri: number | null;
  }[];
}

const STATE_ORDER: VehicleState[] = ['available', 'rented', 'service', 'sold', 'out'];

/** One model: its prices, where its mopeds are, and every order it was on. */
export function ModelPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const navigate = useNavigate();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/models/${id}` : null);
  const all = useLoad<{ models: { brand: string }[] }>(can('settings.manage') ? '/api/models?archived=1' : null);
  const [editing, setEditing] = useState(false);

  const vehicles = data?.vehicles ?? [];
  const sorted = useSortable(
    vehicles,
    {
      vin: { value: (v) => v.vin },
      color: { value: (v) => v.color },
      state: { value: (v) => STATE_ORDER.indexOf(v.state) },
      pool: { value: (v) => (v.state === 'sold' || v.state === 'out' ? null : v.pool) },
      place: { value: (v) => v.location?.name },
    },
    (a, b) => a.vin.localeCompare(b.vin),
    'state',
  );

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const m = data.model;

  return (
    <>
      <PageHead
        wrap
        title={`${m.brand} ${m.name}`}
        badge={m.archived ? <span className="state state-out">{t.models.hiddenOne}</span> : undefined}
        sub={t.fleet.count(m.vehicles)}
      >
        {can('settings.manage') && (
          <button type="button" className="pill pill-sm" onClick={() => setEditing(true)}>
            {t.models.edit}
          </button>
        )}
      </PageHead>

      <div className="two-col">
        <section className="card">
          <BlockHead title={t.models.prices} />
          <Row k={t.models.weeklyRate} v={<span className="mono">{m.weeklyRateTetri != null ? formatGel(m.weeklyRateTetri, { decimals: false }) : t.models.notRented}</span>} />
          <Row k={t.models.salePrice} v={<span className="mono">{m.salePriceTetri != null ? formatGel(m.salePriceTetri, { decimals: false }) : t.common.dash}</span>} />
          <Row
            k={t.models.cost}
            v={
              m.costTetri == null ? (
                <span className="muted">{t.models.noCost}</span>
              ) : (
                <span>
                  <span className="mono">
                    {/* The figure of an unsettled shipment is still moving,
                        and the model's card is where a sale price is set from
                        it (§7, QA-W5-29). */}
                    {m.costSource?.kind === 'purchase' && m.costSource.preliminary && <span className="muted">≈ </span>}
                    {formatGel(m.costTetri)}
                  </span>
                  {m.costSource?.kind === 'purchase' ? (
                    <span className="muted">
                      {' · '}
                      <Link to={`/purchases/${m.costSource.purchaseId}`}>{m.costSource.number}</Link>
                    </span>
                  ) : (
                    <CostFrom source={m.costSource} />
                  )}
                  {m.costSource?.kind === 'purchase' && m.costSource.preliminary && (
                    <span className="hint warn-text">{t.receipt.costPreliminary(m.costSource.paidPercent)}</span>
                  )}
                </span>
              )
            }
          />
        </section>

        <section className="card">
          <BlockHead title={t.models.inFleet} />
          {(['rent', 'sale', 'none', 'gone'] as const).map((k) => (
            <Row key={k} k={t.pools[k]} v={<span className="mono">{m.fleet[k]}</span>} />
          ))}
          <Row k={t.models.onOrder} v={<span className="mono">{m.onOrder > 0 ? m.onOrder : t.common.dash}</span>} />
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.models.vehicles} sub={t.fleet.count(vehicles.length)} />
        {vehicles.length === 0 ? (
          <Empty text={t.models.noVehicles} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th><SortHead k="vin" label={t.fleet.vin} {...sorted} /></th>
                  <th><SortHead k="color" label={t.fleet.color} {...sorted} /></th>
                  <th><SortHead k="state" label={t.fleet.state} {...sorted} /></th>
                  <th><SortHead k="pool" label={t.fleet.pool} {...sorted} /></th>
                  <th><SortHead k="place" label={t.fleet.where} {...sorted} /></th>
                </tr>
              </thead>
              <tbody>
                {sorted.rows.map((v) => {
                  const gone = v.state === 'sold' || v.state === 'out';
                  return (
                    <tr key={v.id} className="tr-go" onClick={rowClick(() => navigate(`/fleet/${v.id}`))}>
                      <td>
                        <Link to={`/fleet/${v.id}`}>
                          <Vin vin={v.vin} />
                        </Link>
                      </td>
                      <td><ColorText of={v.color} /></td>
                      <td><StateBadge state={v.state} /></td>
                      <td>{gone ? t.common.dash : t.pools[v.pool ?? 'none']}</td>
                      <td><PlaceText of={v} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.purchases.title} sub={t.purchases.linesCount(data.orders.length)} />
        {data.orders.length === 0 ? (
          <Empty text={t.models.noOrders} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.purchases.number}</th>
                  <th>{t.models.orderStatus}</th>
                  <th>{t.purchases.orderedOn}</th>
                  <th>{t.purchases.receivedOn}</th>
                  <th className="num">{t.purchases.qty}</th>
                  <th className="num">{t.models.unitPrice}</th>
                  <th className="num">{t.purchases.unitCost}</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o) => (
                  <tr key={o.lineId} className="tr-go" onClick={rowClick(() => navigate(`/purchases/${o.purchaseId}`))}>
                    <td>
                      <Link to={`/purchases/${o.purchaseId}`} className="mono">{o.number}</Link>
                    </td>
                    <td>{t.purchases.statuses[o.status]}</td>
                    <td className="mono">{fmtDate(o.orderedOn)}</td>
                    <td className="mono">{o.receivedOn ? fmtDate(o.receivedOn) : t.common.dash}</td>
                    <td className="num mono">{o.qty}</td>
                    <td className="num mono">{formatForeign(o.unitPriceMinor, o.currency)}</td>
                    <td className="num mono">{o.unitCostTetri != null ? formatGel(o.unitCostTetri) : t.common.dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing && (
        <ModelDrawer
          model={m}
          brands={(all.data?.models ?? [m]).map((x) => x.brand)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </>
  );
}
