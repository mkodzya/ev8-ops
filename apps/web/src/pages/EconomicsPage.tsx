import { Link } from 'react-router-dom';
import { BlockHead, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

export interface EconomicsRow {
  id: string;
  vin: string;
  model: string;
  state: 'available' | 'rented' | 'service' | 'out' | 'sold';
  arrivedOn: string | null;
  costTetri: number | null;
  rentalRevenueTetri: number;
  saleRevenueTetri: number;
  buyBackTetri: number;
  serviceCompanyTetri: number;
  serviceChargedTetri: number;
  marginTetri: number | null;
  idleDays: number;
  days: Record<'available' | 'rented' | 'service' | 'out' | 'sold', number>;
}

interface Totals {
  vehicles: number;
  unpriced: number;
  costTetri: number;
  rentalRevenueTetri: number;
  saleRevenueTetri: number;
  buyBackTetri: number;
  serviceCompanyTetri: number;
  marginTetri: number;
  rentedDays: number;
  idleDays: number;
}

/** How much of what it cost has come back, as a whole per cent. */
export function paybackPct(row: EconomicsRow): number | null {
  if (!row.costTetri) return null;
  return Math.round(((row.rentalRevenueTetri + row.saleRevenueTetri - row.buyBackTetri) / row.costTetri) * 100);
}

export function perRentedDay(row: EconomicsRow): number | null {
  return row.days.rented > 0 ? Math.round(row.rentalRevenueTetri / row.days.rented) : null;
}

/** What each moped earned and cost (DSH-03). */
export function EconomicsPage() {
  const t = useT();
  const { data, error } = useLoad<{ rows: EconomicsRow[]; totals: Totals }>('/api/economics');

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const { rows, totals } = data;

  return (
    <>
      <PageHead wrap title={t.economics.title} sub={t.economics.count(totals.vehicles)} note={t.economics.subtitle} />

      <div className="two-col">
        <section className="card">
          <BlockHead title={t.economics.totals} />
          <Row k={t.economics.cost} v={<span className="mono">{formatGel(totals.costTetri, { decimals: false })}</span>} />
          <Row k={t.economics.rentalRevenue} v={<span className="mono">{formatGel(totals.rentalRevenueTetri, { decimals: false })}</span>} />
          <Row k={t.economics.serviceCompany} v={<span className="mono">{formatGel(totals.serviceCompanyTetri, { decimals: false })}</span>} />
          <Row
            k={t.economics.margin}
            v={
              <span className={`mono ${totals.marginTetri < 0 ? 'crit-text' : 'state-available'}`}>
                {formatGel(totals.marginTetri, { decimals: false })}
              </span>
            }
          />
        </section>
        <section className="card">
          <Row k={t.economics.rentedDays} v={<span className="mono">{totals.rentedDays}</span>} />
          <Row k={t.economics.idleDays} v={<span className="mono">{totals.idleDays}</span>} />
          <Row k={t.economics.unpriced} v={<span className={`mono ${totals.unpriced > 0 ? 'crit-text' : ''}`}>{totals.unpriced}</span>} />
          {totals.unpriced > 0 && <p className="hint">{t.economics.unpricedHint}</p>}
          <p className="hint">{t.economics.since}</p>
        </section>
      </div>

      {rows.length === 0 ? (
        <Empty text={t.economics.none} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.economics.vin}</th>
                <th>{t.economics.model}</th>
                <th className="num">{t.economics.cost}</th>
                <th className="num">{t.economics.rentalRevenue}</th>
                <th className="num">{t.economics.serviceCompany}</th>
                <th className="num">{t.economics.saleRevenue}</th>
                <th className="num">{t.economics.margin}</th>
                <th className="num">{t.economics.payback}</th>
                <th className="num">{t.economics.rentedDays}</th>
                <th className="num">{t.economics.idleDays}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const back = paybackPct(r);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/fleet/${r.id}`}>
                        <Vin vin={r.vin} />
                      </Link>
                    </td>
                    <td className="muted">{r.model}</td>
                    <td className="num mono">{r.costTetri == null ? <span className="muted">{t.economics.noCost}</span> : formatGel(r.costTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(r.rentalRevenueTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(r.serviceCompanyTetri, { decimals: false })}</td>
                    <td className="num mono">
                      {r.saleRevenueTetri === 0 && r.buyBackTetri === 0
                        ? t.common.dash
                        : formatGel(r.saleRevenueTetri - r.buyBackTetri, { decimals: false })}
                    </td>
                    <td className={`num mono ${r.marginTetri == null ? 'muted' : r.marginTetri < 0 ? 'crit-text' : 'state-available'}`}>
                      {r.marginTetri == null ? t.common.dash : formatGel(r.marginTetri, { decimals: false })}
                    </td>
                    <td className="num mono">{back == null ? t.common.dash : `${back}%`}</td>
                    <td className="num mono">{r.days.rented}</td>
                    <td className="num mono">{r.idleDays}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** The same figures for one moped, shown on its own card. */
export function VehicleEconomics({ vehicleId }: { vehicleId: string }) {
  const t = useT();
  const { data } = useLoad<{ economics: EconomicsRow }>(`/api/fleet/${vehicleId}/economics`);
  if (!data) return null;
  const r = data.economics;
  const back = paybackPct(r);
  const perDay = perRentedDay(r);

  return (
    <section className="card">
      <BlockHead title={t.economics.title} />
      <Row
        k={t.economics.cost}
        v={<span className="mono">{r.costTetri == null ? <span className="muted">{t.economics.noCost}</span> : formatGel(r.costTetri)}</span>}
      />
      <Row k={t.economics.rentalRevenue} v={<span className="mono">{formatGel(r.rentalRevenueTetri)}</span>} />
      {r.serviceCompanyTetri > 0 && <Row k={t.economics.serviceCompany} v={<span className="mono">{formatGel(r.serviceCompanyTetri)}</span>} />}
      {r.serviceChargedTetri > 0 && <Row k={t.economics.serviceCharged} v={<span className="mono">{formatGel(r.serviceChargedTetri)}</span>} />}
      {r.saleRevenueTetri > 0 && <Row k={t.economics.saleRevenue} v={<span className="mono">{formatGel(r.saleRevenueTetri)}</span>} />}
      {r.buyBackTetri > 0 && <Row k={t.economics.buyBack} v={<span className="mono">{formatGel(r.buyBackTetri)}</span>} />}
      <Row
        k={t.economics.margin}
        v={
          <span className={`mono ${r.marginTetri == null ? 'muted' : r.marginTetri < 0 ? 'crit-text' : 'state-available'}`}>
            {r.marginTetri == null ? t.common.dash : formatGel(r.marginTetri)}
          </span>
        }
      />
      {back != null && <Row k={t.economics.payback} v={<span className="mono">{back}%</span>} />}
      <Row k={t.economics.rentedDays} v={<span className="mono">{r.days.rented}</span>} />
      <Row k={t.economics.idleDays} v={<span className="mono">{r.idleDays}</span>} />
      {perDay != null && <Row k={t.economics.perRentedDay} v={<span className="mono">{formatGel(perDay)}</span>} />}
    </section>
  );
}
