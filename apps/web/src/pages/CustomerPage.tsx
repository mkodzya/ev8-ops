import { CUSTOMER_SOURCES, type CustomerKind, type DepositStatus, type RentalStatus } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { preparePhoto, uploadFile } from '../lib/photos.js';
import { useOperation } from '../ds/form/operation.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { useToast } from '../ds/feedback/Toast.js';
import '../ds/form/form.css';
import { api, ApiError } from '../api.js';
import { FormSheet } from '../ds/form/Form.js';
import { Field } from '../components/Wizard.js';
import { WhatsappSheet } from '../components/Whatsapp.js';
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
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; personalId: string | null; phone: string | null; email: string | null; address: string | null; kind: CustomerKind; tags: string[]; notes: string | null; source: string | null };
  documents: { id: string; docKind: 'id_card' | 'driver_licence' | 'other'; label: string; sizeBytes: number; mimeType: string; createdAt: string }[];
  sales: { id: string; number: string; status: string; soldOn: string | null; priceTetri: number; instalments: number; instalmentsPaid: number }[];
  feed: { at: string; kind: 'payment' | 'document' | 'log'; text: string; number: string | null; amountTetri: number | null; by: string | null; note: string | null }[];
  canOpenDocuments: boolean;
  rentals: { id: string; number: string; status: RentalStatus; vehicle: { id: string; vin: string } | null; vinUnconfirmed: boolean; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number; deposit: { amountTetri: number; status: DepositStatus } | null }[];
}

interface Balance {
  owesTetri: number;
  creditTetri: number;
  aheadTetri: number;
  depositHeldTetri: number;
  parts: { kind: 'rent' | 'deposit' | 'sale' | 'service'; id: string; number: string; owesTetri: number }[];
}

export function CustomerPage() {
  const { id } = useParams();
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const openMoney = useMoneyForm();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/customers/${id}` : null);
  const balance = useLoad<Balance>(id ? `/api/customers/${id}/balance` : null);
  const [docKind, setDocKind] = useState<'id_card' | 'driver_licence' | 'other'>('id_card');
  const upload = useOperation();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [wa, setWa] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'payment' | 'document' | 'log'>('all');
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const c = data.customer;

  const addDocument = async (list: FileList | null) => {
    const f = list?.[0];
    if (!f) return;
    // Each chosen file is its own write: the scope is the file, so choosing it
    // again after a lost answer is a retry, and another file is a new document.
    const res = await upload.run(async (key) => {
      const prepared = f.type === 'application/pdf' ? { name: f.name, mimeType: 'application/pdf', blob: f } : await preparePhoto(f);
      await uploadFile(`/api/customers/${c.id}/documents`, prepared, { docKind }, key);
    }, `${f.name}:${f.size}:${f.lastModified}:${docKind}`);
    if (fileRef.current) fileRef.current.value = '';
    if (!res.ok) return;
    upload.reset();
    toast({ text: t.documents.added });
    reload();
  };
  return (
    <>
      <PageHead wrap title={primaryName(c, locale)} sub={secondName(c, locale)}>
        {c.phone && (
          <a className="pill pill-sm" href={`tel:${c.phone}`}>
            {t.today.call}
          </a>
        )}
        {c.phone && (
          // The ready text in the customer's language (wave 4 §3.2, В6).
          <button type="button" className="pill pill-sm" onClick={() => setWa(true)}>
            {t.customer.whatsapp}
          </button>
        )}
        {can('customer.create') && (
          <button type="button" className="pill pill-sm" onClick={() => setEditing(true)}>
            {t.customerW4.edit}
          </button>
        )}
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/new?customer=${c.id}`}>
            {t.actions.newRental}
          </Link>
        )}
      </PageHead>

      {/* The one debt figure (wave 2 §3.7, B7-02): what is owed, big; what it is
          made of by record; the schedule ahead and the deposit quietly below —
          neither is a debt. The same figure "Today", the rental and the search show. */}
      {balance.data && (
        <section className="card debt-card">
          <p className={`bal-line ${balance.data.owesTetri > 0 ? 'crit-text' : balance.data.creditTetri > 0 ? 'state-available' : 'muted'}`}>
            {balance.data.owesTetri > 0
              ? t.money.owes(formatGel(balance.data.owesTetri))
              : balance.data.creditTetri > 0
                ? t.money.onAccount(formatGel(balance.data.creditTetri))
                : `${t.money.noDebt} · ${formatGel(0)}`}
          </p>
          {balance.data.parts.map((p) => (
            <Row key={`${p.kind}-${p.id}`} k={`${p.kind === 'deposit' ? t.money.closeDeposit : t.money.kinds[p.kind === 'service' ? 'service' : p.kind === 'sale' ? 'sale' : 'rent']} · ${p.number}`} v={<span className="mono">{formatGel(p.owesTetri)}</span>} />
          ))}
          {balance.data.aheadTetri > 0 && <Row k={t.money.ahead} v={<span className="mono muted">{formatGel(balance.data.aheadTetri)}</span>} />}
          {balance.data.depositHeldTetri > 0 && <Row k={t.money.depositHeld} v={<span className="mono muted">{formatGel(balance.data.depositHeldTetri)}</span>} />}
          {can('cash.record') && (
            <div className="row-actions">
              <button type="button" className="pill pill-sm pill-accent" onClick={() => openMoney({ target: { kind: 'on_account', customerId: c.id, customer: c.name } })}>
                {can('payments.reconcile') ? t.money.take : t.money.takeCash}
              </button>
            </div>
          )}
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
          <Row k={t.customerW4.source} v={c.source ? t.customerW4.sources[c.source] ?? c.source : t.common.dash} />
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
                {upload.state === 'busy' ? t.form.saving : `+ ${t.documents.add}`}
              </label>
            </div>
          )}
          {upload.failure && <div className="field-err" role="alert">{upload.failure.text}</div>}
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

      {/* One timeline with a filter (B7-04, ux №7): money, documents, changes. */}
      <section className="card">
        <div className="queue-head">
          <h2>{t.customerW4.feed}</h2>
          <div className="chips">
            {(['all', 'payment', 'document', 'log'] as const).map((f) => (
              <button key={f} type="button" className={`pill pill-sm ${feedFilter === f ? 'on' : ''}`} onClick={() => setFeedFilter(f)}>
                {t.customerW4.feedFilters[f]}
              </button>
            ))}
          </div>
        </div>
        {data.feed.filter((e) => feedFilter === 'all' || e.kind === feedFilter).length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {data.feed
              .filter((e) => feedFilter === 'all' || e.kind === feedFilter)
              .slice(0, 50)
              .map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="mono muted">{fmtDate(e.at)}</span>
                  <span>
                    {e.kind === 'payment' && (
                      <>
                        <span className="mono">{formatGel(e.amountTetri ?? 0)}</span> <span className="muted">{t.payments.channels[e.text as 'cash'] ?? e.text}</span>
                        {e.number && <span className="muted"> · {e.number}</span>}
                      </>
                    )}
                    {e.kind === 'document' && <span>{t.documents.kinds[e.text as 'id_card'] ?? e.text}</span>}
                    {e.kind === 'log' && <span className="muted">{e.text}{e.note ? ` · ${e.note}` : ''}</span>}
                    {e.by && <span className="muted"> · {e.by}</span>}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {editing && <CustomerEdit customer={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
      {wa && c.phone && (
        <WhatsappSheet
          target={{ rentalId: data.rentals.find((r) => r.status !== 'returned')?.id ?? null, number: data.rentals[0]?.number ?? '', name: c.name, phone: c.phone, paidThrough: data.rentals[0]?.paidThrough ?? null, debtTetri: balance.data?.owesTetri ?? 0 }}
          onClose={() => setWa(false)}
        />
      )}
    </>
  );
}

/** "⋯ → Изменить" (§3.5): a manager edits the contacts, a duplicate number is caught (crit. 21). */
function CustomerEdit({ customer, onClose, onSaved }: { customer: Card['customer']; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { can } = useSession();
  const initial = { name: customer.name, nameKa: customer.nameKa ?? '', nameLat: customer.nameLat ?? '', phone: customer.phone ?? '', source: customer.source ?? '' };
  const [f, setF] = useState(initial);
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);
  return (
    <FormSheet
      title={t.customerW4.editTitle(customer.name)}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.actions.save}
      fieldOf={{ duplicate_phone: 'phone' }}
      submit={async (key) => {
        setTwin(null);
        try {
          await api.patch(`/api/customers/${customer.id}`, { name: f.name.trim(), nameKa: f.nameKa || null, nameLat: f.nameLat || null, phone: f.phone || null, source: f.source || null }, { key });
        } catch (e) {
          if (e instanceof ApiError && e.code === 'duplicate_phone') setTwin(e.extra.existing as { id: string; name: string });
          throw e;
        }
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <Field label={t.customer.phone} name="phone">
        <input className="input mono" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      {twin && (
        <p className="warn-text">
          {t.customerW4.phoneTaken(twin.name)}{' '}
          <Link className="pill pill-sm" to={`/customers/${twin.id}`} onClick={onClose}>
            {t.hand.openExisting}
          </Link>
        </p>
      )}
      <Field label={t.customer.name} name="name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label={t.customer.nameKa} name="nameKa">
        <input className="input" value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
      </Field>
      <Field label={t.customer.nameLat} name="nameLat">
        <input className="input" value={f.nameLat} onChange={(e) => setF({ ...f, nameLat: e.target.value })} />
      </Field>
      <Field label={t.customerW4.source} name="source">
        <div className="chips">
          {CUSTOMER_SOURCES.map((s) => (
            <button key={s} type="button" className={`pill pill-sm ${f.source === s ? 'on' : ''}`} onClick={() => setF({ ...f, source: f.source === s ? '' : s })}>
              {t.customerW4.sources[s]}
            </button>
          ))}
        </div>
      </Field>
      {!can('customer.documents.view') && <p className="hint muted">{t.customer.personalId}: {t.common.dash}</p>}
    </FormSheet>
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
