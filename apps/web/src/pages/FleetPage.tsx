import { VEHICLE_STATES, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, StateBadge, Vin } from '../components/ui.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';

interface Vehicle {
  id: string;
  vin: string;
  model: string;
  color: string | null;
  year: number | null;
  arrivedOn: string | null;
  state: VehicleState;
  currentRental: { id: string; number: string; paidThrough: string | null; customer: { id: string; name: string } } | null;
}

interface Fleet {
  byState: Record<VehicleState, number>;
  vehicles: Vehicle[];
}

export function FleetPage() {
  const t = useT();
  const [data, setData] = useState<Fleet | null>(null);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const state = params.get('state') as VehicleState | null;

  useEffect(() => {
    void api.get<Fleet>('/api/fleet').then(setData);
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    return data.vehicles.filter((v) => (!state || v.state === state) && (!needle || v.vin.endsWith(needle) || v.vin.includes(needle)));
  }, [data, state, q]);

  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.fleet.title}</h1>
        <span className="muted">{t.fleet.count(data.vehicles.length)}</span>
      </header>
      <div className="toolbar">
        <div className="chips">
          <button type="button" className={`pill pill-sm ${!state ? 'on' : ''}`} onClick={() => setParams({})}>
            {t.common.all}
          </button>
          {VEHICLE_STATES.map((st) => (
            <button
              key={st}
              type="button"
              className={`pill pill-sm ${state === st ? 'on' : ''}`}
              onClick={() => setParams({ state: st })}
            >
              {t.states[st]} <span className="mono">{data.byState[st]}</span>
            </button>
          ))}
        </div>
        <input className="input input-search mono" placeholder={t.fleet.searchHint} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <Empty text={t.fleet.empty} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.fleet.vin}</th>
                <th>{t.fleet.model}</th>
                <th>{t.fleet.color}</th>
                <th>{t.fleet.year}</th>
                <th>{t.fleet.arrived}</th>
                <th>{t.fleet.state}</th>
                <th>{t.fleet.renter}</th>
                <th>{t.fleet.paidThrough}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Vin vin={v.vin} />
                  </td>
                  <td>{v.model}</td>
                  <td>{v.color ?? t.common.dash}</td>
                  <td className="mono">{v.year ?? t.common.dash}</td>
                  <td className="mono">{fmtDate(v.arrivedOn)}</td>
                  <td>
                    <StateBadge state={v.state} />
                  </td>
                  <td>{v.currentRental?.customer.name ?? t.common.dash}</td>
                  <td className="mono">{v.currentRental ? fmtDate(v.currentRental.paidThrough) : t.common.dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
