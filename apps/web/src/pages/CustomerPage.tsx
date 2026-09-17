import type { CustomerKind, DepositStatus, RentalStatus } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { preparePhoto, uploadFile } from '../lib/photos.js';
import { errorText } from '../lib/use.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead, RentalBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { primaryName, secondName } from '../lib/names.js';
import { useLoad } from '../lib/use.js';
import { fmtDate as fmtDay } from '../format.js';
import { useSession } from '../session.js';

interface Card {
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; personalId: string | null; phone: string | null; email: string | null; address: string | null; kind: CustomerKind; tags: string[]; notes: string | null };
  documents: { id: string; docKind: 'id_card' | 'driver_licence' | 'other'; label: string; sizeBytes: number; mimeType: string; createdAt: string }[];
  canOpenDocuments: boolean;
  rentals: { id: string; number: string; status: RentalStatus; vehicle: { id: string; vin: string } | null; vinUnconfirmed: boolean; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number; deposit: { amountTetri: number; status: DepositStatus } | null }[];
}

interface Balance {
  invoicedTetri: number;
  paidTetri: number;
  outstandingTetri: number;
  creditTetri: number;
  depositHeldTetri: number;
}

export function CustomerPage() {
  const { id } = useParams();
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/customers/${id}` : null);
  const balance = useLoad<Balance>(id ? `/api/customers/${id}/balance` : null);
  const [docKind, setDocKind] = useState<'id_card' | 'driver_licence' | 'other'>('id_card');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const c = data.customer;

  const addDocument = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const prepared = f.type === 'application/pdf' ? { name: f.name, mimeType: 'application/pdf', blob: f } : await preparePhoto(f);
      await uploadFile(`/api/customers/${c.id}/documents`, prepared, { docKind });
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };
  return (
    <>
      <PageHead wrap title={primaryName(c, locale)} sub={secondName(c, locale)}>
        {c.phone && (
          // The number the company actually reaches people on. A link, not an
          // integration: WhatsApp templates are MSG-01 and wait on a Meta token.
          <a className="pill pill-sm" href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
            {t.customer.whatsapp}
          </a>
        )}
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/new?customer=${c.id}`}>
            {t.actions.newRental}
          </Link>
        )}
      </PageHead>

      {/* The first line answers the question the card is opened with (U9).
          The four figures it is made of are underneath, smaller. */}
      {balance.data && (
        <p className={`bal-line ${balance.data.outstandingTetri > 0 ? 'crit-text' : balance.data.creditTetri > 0 ? 'state-available' : 'muted'}`}>
          {balance.data.outstandingTetri > 0
            ? t.balance.owes(formatGel(balance.data.outstandingTetri))
            : balance.data.creditTetri > 0
              ? t.balance.overpaid(formatGel(balance.data.creditTetri))
              : t.balance.clear}
        </p>
      )}

      {balance.data && (
        <section className="tiles tiles-quiet">
          <div className={`tile ${balance.data.outstandingTetri > 0 ? 'tile-crit' : ''}`}>
            <span className="tile-num mono">{formatGel(balance.data.outstandingTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.balance.outstanding}</span>
          </div>
          <div className="tile">
            <span className="tile-num mono">{formatGel(balance.data.creditTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.balance.credit}</span>
          </div>
          <div className="tile">
            <span className="tile-num mono">{formatGel(balance.data.depositHeldTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.balance.depositHeld}</span>
          </div>
          <div className="tile">
            <span className="tile-num mono">{formatGel(balance.data.paidTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.balance.paid}</span>
          </div>
        </section>
      )}
      <div className="two-col">
        <section className="card">
          {c.nameKa && <Row k={t.customer.nameKa} v={c.nameKa} />}
          <Row k={t.customer.phone} v={<span className="mono">{c.phone ?? t.common.dash}</span>} />
          <Row k={t.customer.personalId} v={<span className="mono">{c.personalId ?? t.common.dash}</span>} />
          <Row k={t.customer.email} v={c.email ?? t.common.dash} />
          <Row k={t.customer.address} v={c.address ?? t.common.dash} />
          <Row k={t.customer.kind} v={t.customer.kinds[c.kind]} />
          <Row k={t.customers.tags} v={c.tags.length ? c.tags.map((x) => <span key={x} className="chip">{x}</span>) : t.common.dash} />
          {c.notes && <Row k={t.customer.notes} v={<span className="pre">{c.notes}</span>} />}
        </section>
        <section className="card">
          <BlockHead title={t.documents.title} sub={t.documents.count(data.documents.length)} />
          {data.documents.length === 0 ? (
            <p className="empty">{t.documents.none}</p>
          ) : (
            <ul className="timeline">
              {data.documents.map((d) => (
                <li key={d.id}>
                  <span className="mono muted">{fmtDay(d.createdAt.slice(0, 10))}</span>
                  <span>
                    {data.canOpenDocuments ? (
                      <a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer">
                        {t.documents.kinds[d.docKind]}
                      </a>
                    ) : (
                      t.documents.kinds[d.docKind]
                    )}
                    <span className="muted"> · {Math.round(d.sizeBytes / 1024)} KB</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {!data.canOpenDocuments && data.documents.length > 0 && <p className="hint muted">{t.documents.restricted}</p>}
          {can('customer.create') && (
            <div className="row-actions">
              <select className="input input-amount" value={docKind} onChange={(e) => setDocKind(e.target.value as typeof docKind)}>
                {(['id_card', 'driver_licence', 'other'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.documents.kinds[k]}
                  </option>
                ))}
              </select>
              <label className="pill pill-sm">
                <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => void addDocument(e.target.files)} />
                {busy ? t.common.checking : `+ ${t.documents.add}`}
              </label>
            </div>
          )}
          {err && <div className="hint hint-bad">{err}</div>}
        </section>
        <section className="card">
          <BlockHead title={t.sales.title} />
          <CustomerSales customerId={c.id} />
        </section>
        <section className="card">
          <BlockHead title={t.customer.rentals} sub={t.rentals.count(data.rentals.length)} />
          {data.rentals.length === 0 ? (
            <Empty text={t.customer.noRentals} />
          ) : (
            <ul className="timeline">
              {data.rentals.map((r) => (
                <li key={r.id}>
                  <span className="mono muted">{fmtDate(r.pickedUpOn)}</span>
                  <span>
                    <Link to={`/rentals/${r.id}`} className="mono">{r.number}</Link> <RentalBadge status={r.status} />{' '}
                    {r.vehicle ? <Vin vin={r.vehicle.vin} /> : <span className="warn-text">{t.rentals.vinUnconfirmed}</span>}
                    <span className="muted"> · {formatGel(r.weeklyRateTetri, { decimals: false })}{t.rentals.perWeek}</span>
                    {r.returnedOn && <span className="muted"> · {fmtDate(r.returnedOn)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}


/** The sales this customer has, with what is still owed on each. */
function CustomerSales({ customerId }: { customerId: string }) {
  const t = useT();
  const { data, failure, reload } = useLoad<{ sales: { id: string; number: string; soldOn: string; customer: { id: string }; priceTetri: number; outstandingTetri: number; overdueTetri: number; status: 'active' | 'cancelled' | 'bought_back' }[] }>(
    '/api/sales',
  );
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const mine = data.sales.filter((s) => s.customer.id === customerId);
  if (mine.length === 0) return <Empty text={t.sales.none} />;
  return (
    <ul className="timeline">
      {mine.map((s) => (
        <li key={s.id}>
          <span className="mono muted">{fmtDate(s.soldOn)}</span>
          <span>
            <Link to={`/sales/${s.id}`} className="mono">
              {s.number}
            </Link>{' '}
            <span className="muted">{t.sales.statuses[s.status]}</span>
            <span className="muted"> · {formatGel(s.priceTetri, { decimals: false })}</span>
            {s.outstandingTetri > 0 && (
              <span className={s.overdueTetri > 0 ? 'crit-text' : 'muted'}>
                {' '}
                · {t.sales.outstanding} {formatGel(s.outstandingTetri, { decimals: false })}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
