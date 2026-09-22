import { formatGel } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { api } from '../api.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

// Settings → Transfer (wave 6 §3.6–3.7).
//
// The five starting states are wizards elsewhere; this screen names them and
// links to them. What it does itself is the part nobody had a screen for:
// the deposits the move brought over with no decision in them, the rentals
// whose VIN never came, and the mopeds Odoo called "in service" with no
// repair behind them.
//
// Every number here is read from the database. The wave's own text names
// seventeen deposits and two rentals without a VIN; the stand holds other
// figures, and a screen that prints a number from a document is the first
// wrong answer somebody acts on (CLAUDE.md rule 1).

type Decision = 'returned_earlier' | 'kept_earlier' | 'unknown';
const DECISIONS: Decision[] = ['returned_earlier', 'kept_earlier', 'unknown'];

interface Migration {
  deposits: {
    due: {
      count: number;
      amountTetri: number;
      rows: { id: string; rentalId: string; number: string; who: string; endedOn: string | null; receivedTetri: number; contractTetri: number }[];
    };
    running: { count: number; amountTetri: number };
  };
  rentalsWithoutVin: { count: number; rows: { id: string; number: string; status: string; who: string; pickedUpOn: string | null; note: string | null }[] };
  vehiclesInServiceWithoutJob: { count: number; rows: { id: string; vin: string; model: string | null; arrivedOn: string | null }[] };
}

export function MigrationPage() {
  const t = useT();
  const m = useLoad<Migration>('/api/migration');

  if (!m.data) {
    return (
      <>
        <PageHead title={t.migrationPage.title} sub={t.migrationPage.subtitle} />
        {m.failure ? <LoadError failure={m.failure} onRetry={m.reload} /> : <Loading />}
      </>
    );
  }
  const d = m.data;

  return (
    <>
      <PageHead title={t.migrationPage.title} sub={t.migrationPage.subtitle} />

      {/* The five that are entered elsewhere: named here so that "where do I
          put a rental that started before the move" has one answer. */}
      <section className="card">
        <BlockHead title={t.migrationPage.starting} note={t.migrationPage.startingNote} />
        <ul className="act-list">
          <li className="act-item">
            <Link to="/rentals/new?transfer=1">{t.migrationPage.rows.rental}</Link>
            <span className="muted"> · {t.migrationPage.rows.rentalNote}</span>
          </li>
          <li className="act-item">
            <Link to="/sales/new?transfer=1">{t.migrationPage.rows.sale}</Link>
            <span className="muted"> · {t.migrationPage.rows.saleNote}</span>
          </li>
          <li className="act-item">
            <Link to="/service/stock">{t.migrationPage.rows.stock}</Link>
            <span className="muted"> · {t.migrationPage.rows.stockNote}</span>
          </li>
          <li className="act-item">
            <Link to="/purchases">{t.migrationPage.rows.supplier}</Link>
            <span className="muted"> · {t.migrationPage.rows.supplierNote}</span>
          </li>
        </ul>
      </section>

      <Deposits data={d.deposits} onDone={m.reload} />

      <section className="card">
        <BlockHead title={t.migrationPage.noVin} sub={d.rentalsWithoutVin.count > 0 ? t.migrationPage.noVinNote(d.rentalsWithoutVin.count, d.rentalsWithoutVin.count) : undefined} />
        {d.rentalsWithoutVin.count === 0 ? (
          <Empty text={t.migrationPage.nothing} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <tbody>
                {d.rentalsWithoutVin.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">
                      <Link to={`/rentals/${r.id}`}>{r.number}</Link>
                    </td>
                    <td>{r.who}</td>
                    <td className="muted">{fmtDate(r.pickedUpOn)}</td>
                    <td className="muted">{r.note ?? ''}</td>
                    <td className="num">
                      <Link className="pill pill-sm" to={`/rentals/${r.id}`}>
                        {t.migrationPage.fill}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <InService rows={d.vehiclesInServiceWithoutJob.rows} onDone={m.reload} />
    </>
  );
}

/**
 * The batch (§3.7, crit. 24–26). Three quick answers, a reason for all of
 * them, and a line under it saying out loud that no money moves here: an
 * owner pressing "вернули ранее" is recording history, not paying anybody.
 */
function Deposits({ data, onDone }: { data: Migration['deposits']; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const [decision, setDecision] = useState<Decision>('returned_earlier');
  // What is still missing, said out loud. A button that does nothing when
  // pressed is pressed again and again (QA-W6-12).
  const [missing, setMissing] = useState<'' | 'ids' | 'reason'>('');

  const rows = data.due.rows;
  /**
   * A chosen deposit whose contract and payment disagree: the screen asks
   * whether it was taken at all rather than answering for the person
   * (CLAUDE.md rule 1 — the system does not invent what it does not know).
   */
  const asksWhether = rows.some((r) => picked.has(r.id) && r.contractTetri !== r.receivedTetri);
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const mark = async () => {
    const ids = [...picked];
    if (ids.length === 0) return setMissing('ids');
    if (!reason.trim()) return setMissing('reason');
    setMissing('');
    const res = await op.run((key) => api.post('/api/migration/deposits', { ids, decision, reason }, { key }), `${decision}:${ids.length}`);
    if (!res.ok) return;
    toast({ text: t.migrationPage.done(ids.length) });
    setPicked(new Set());
    setReason('');
    op.reset();
    onDone();
  };

  return (
    <section className="card" id="deposits">
      <BlockHead
        title={t.migrationPage.batchTitle}
        sub={rows.length > 0 ? t.migrationPage.batchLead(data.due.count, formatGel(data.due.amountTetri)) : undefined}
        note={t.migrationPage.notMoney}
      />
      {/* The ones nobody is asked about, named rather than hidden and with
          nothing to press: a deposit on a running rental is not undecided —
          the moped is out, the answer comes with the return (designer,
          21.09.2026). This sum plus the batch above is "held" entire. */}
      {data.running.count > 0 && <p className="hint muted">{t.migrationPage.depositsRunning(data.running.count, formatGel(data.running.amountTetri))}</p>}

      {rows.length === 0 ? (
        <Empty text={t.migrationPage.nothing} />
      ) : (
        <>
          <div className="table-wrap table-flat">
            <table className="table">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={picked.has(r.id) ? 'row-on' : ''}>
                    <td>
                      <label className="pick">
                        <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.number} />
                      </label>
                    </td>
                    <td>{r.who}</td>
                    <td className="mono">
                      <Link to={`/rentals/${r.rentalId}`}>{r.number}</Link>
                    </td>
                    <td className="muted">{r.endedOn ? t.migrationPage.endedOn(fmtDate(r.endedOn)) : ''}</td>
                    <td className="num">
                      {formatGel(r.receivedTetri)}
                      {/* Only where the two disagree, and that is the point:
                          a second line nobody sees on most rows is what makes
                          the rare one visible (designer, 22.09). */}
                      {r.contractTetri !== r.receivedTetri && <div className="hint muted">{t.migrationPage.byContract(formatGel(r.contractTetri))}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="list-toolbar">
            <button type="button" className="pill pill-sm" onClick={() => setPicked(new Set(picked.size === rows.length ? [] : rows.map((r) => r.id)))}>
              {t.migrationPage.selectAll}
            </button>
            <span className="muted">{t.migrationPage.selected(picked.size)}</span>
            <div className="chips">
              {DECISIONS.map((x) => (
                <button key={x} type="button" className={`chip ${x === decision ? 'on' : ''}`} onClick={() => setDecision(x)}>
                  {t.migrationPage.decide[x]}
                </button>
              ))}
            </div>
          </div>

          <label className="field" data-field="reason">
            <span className="field-label">{t.migrationPage.reason}</span>
            <input
              className={`input ${missing === 'reason' ? 'field-bad' : ''}`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (missing === 'reason') setMissing('');
              }}
              placeholder={asksWhether ? t.migrationPage.reasonAsk : t.migrationPage.reasonHint}
            />
            {missing === 'reason' && <span className="field-err">{t.migrationPage.needReason}</span>}
          </label>
          {missing === 'ids' && <div className="field-err">{t.migrationPage.needPick}</div>}
          {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
          <SubmitButton type="button" state={op.state} label={t.migrationPage.mark(t.migrationPage.decide[decision])} onClick={() => void mark()} />
        </>
      )}
    </section>
  );
}

/** A moped Odoo called "in service" with nothing behind it (register #23). */
function InService({ rows, onDone }: { rows: Migration['vehiclesInServiceWithoutJob']['rows']; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const back = async (id: string, vin: string) => {
    const res = await op.run((key) => api.post(`/api/migration/vehicles/${id}/back`, { reason }, { key }), `back:${id}`);
    if (!res.ok) return;
    toast({ text: t.migrationPage.backDone(vin) });
    setOpen(null);
    setReason('');
    op.reset();
    onDone();
  };

  return (
    <section className="card">
      <BlockHead title={t.migrationPage.inService} sub={rows.length > 0 ? t.migrationPage.inServiceNote(rows.length) : undefined} />
      {rows.length === 0 ? (
        <Empty text={t.migrationPage.nothing} />
      ) : (
        <div className="table-wrap table-flat">
          <table className="table">
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/fleet/${v.id}`}>
                      <Vin vin={v.vin} />
                    </Link>
                  </td>
                  <td className="muted">{v.model ?? ''}</td>
                  <td className="num">
                    {open === v.id ? (
                      <span className="inline-form">
                        <input
                          className="input input-inline"
                          value={reason}
                          autoFocus
                          placeholder={t.migrationPage.backReason}
                          aria-label={t.migrationPage.backReason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <SubmitButton small type="button" state={op.state} label={t.migrationPage.backToFleet} disabled={!reason.trim()} onClick={() => void back(v.id, v.vin)} />
                      </span>
                    ) : (
                      <>
                        <Link className="pill pill-sm" to={`/service/new?vehicleId=${v.id}`}>
                          {t.migrationPage.openRepair}
                        </Link>{' '}
                        <button type="button" className="pill pill-sm" onClick={() => setOpen(v.id)}>
                          {t.migrationPage.backToFleet}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
