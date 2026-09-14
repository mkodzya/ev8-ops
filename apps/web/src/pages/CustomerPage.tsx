import type { CustomerKind, DepositStatus, RentalStatus } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { preparePhoto, uploadFile } from '../lib/photos.js';
import { errorText } from '../lib/use.js';
import { Empty, Loading, RentalBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { fmtDate as fmtDay } from '../format.js';
import { useSession } from '../session.js';

interface Card {
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; personalId: string | null; phone: string | null; email: string | null; kind: CustomerKind; tags: string[]; notes: string | null };
  documents: { id: string; docKind: 'id_card' | 'driver_licence' | 'other'; label: string; sizeBytes: number; mimeType: string; createdAt: string }[];
  canOpenDocuments: boolean;
  rentals: { id: string; number: string; status: RentalStatus; vehicle: { id: string; vin: string } | null; vinUnconfirmed: boolean; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number; deposit: { amountTetri: number; status: DepositStatus } | null }[];
}

export function CustomerPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<Card>(id ? `/api/customers/${id}` : null);
  const [docKind, setDocKind] = useState<'id_card' | 'driver_licence' | 'other'>('id_card');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (error) return <Empty text={error} />;
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
      <header className="page-head page-head-wrap">
        <h1>{c.name}</h1>
        {c.nameLat && c.nameLat !== c.name && <span className="muted">{c.nameLat}</span>}
        <span className="spacer" />
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/new?customer=${c.id}`}>
            {t.actions.newRental}
          </Link>
        )}
      </header>
      <div className="two-col">
        <section className="card">
          {c.nameKa && <Row k={t.customer.nameKa} v={c.nameKa} />}
          <Row k={t.customer.phone} v={<span className="mono">{c.phone ?? t.common.dash}</span>} />
          <Row k={t.customer.personalId} v={<span className="mono">{c.personalId ?? t.common.dash}</span>} />
          <Row k={t.customer.email} v={c.email ?? t.common.dash} />
          <Row k={t.customer.kind} v={t.customer.kinds[c.kind]} />
          <Row k={t.customers.tags} v={c.tags.length ? c.tags.map((x) => <span key={x} className="chip">{x}</span>) : t.common.dash} />
          {c.notes && <Row k={t.customer.notes} v={<span className="pre">{c.notes}</span>} />}
        </section>
        <section className="card">
          <h2>{t.documents.title}</h2>
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
          <h2>{t.customer.rentals}</h2>
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
