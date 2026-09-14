import { CUSTOMER_KINDS, type CustomerKind } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { Field } from '../components/Wizard.js';
import { useT } from '../i18n/index.js';
import { errorText } from '../lib/use.js';

/** New customer card (CST-01). A duplicate by phone or personal number is
 *  offered as a link rather than silently created twice (CST-02). */
export function CustomerForm({ onCreated, embedded }: { onCreated?: (id: string) => void; embedded?: boolean } = {}) {
  const t = useT();
  const navigate = useNavigate();
  const [f, setF] = useState({ name: '', nameKa: '', nameLat: '', personalId: '', phone: '', email: '', address: '', kind: 'person' as CustomerKind, tags: '', notes: '' });
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  // Ask while they type, not after they submit (U12). A duplicate refused at
  // the end of a nine-field form is a duplicate somebody creates anyway with
  // one digit changed.
  useEffect(() => {
    const phone = f.phone.trim();
    const personalId = f.personalId.trim();
    if (phone.length < 6 && personalId.length < 6) {
      setTwin(null);
      return;
    }
    const timer = setTimeout(() => {
      const q = new URLSearchParams();
      if (phone) q.set('phone', phone);
      if (personalId) q.set('personalId', personalId);
      void api
        .get<{ existing: { id: string; name: string } | null }>(`/api/customers/lookup?${q.toString()}`)
        .then((r) => setTwin(r.existing))
        .catch(() => setTwin(null));
    }, 400);
    return () => clearTimeout(timer);
  }, [f.phone, f.personalId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setTwin(null);
    try {
      const { id } = await api.post<{ id: string }>('/api/customers', {
        ...f,
        tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean),
      });
      if (onCreated) onCreated(id);
      else navigate(`/customers/${id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_customer') setTwin(e.extra.existing as { id: string; name: string });
      else setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={embedded ? 'form' : 'form form-page'} onSubmit={submit}>
      {!embedded && (
        <header className="page-head">
          <h1>{t.customer.newTitle}</h1>
        </header>
      )}
      <Field label={t.customer.name}>
        <input className="input" value={f.name} onChange={set('name')} required autoFocus />
      </Field>
      <div className="two-col">
        <Field label={t.customer.nameKa}>
          <input className="input" value={f.nameKa} onChange={set('nameKa')} />
        </Field>
        <Field label={t.customer.nameLat}>
          <input className="input" value={f.nameLat} onChange={set('nameLat')} />
        </Field>
        <Field label={t.customer.phone}>
          <input className="input mono" value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="+995" />
        </Field>
        <Field label={t.customer.personalId}>
          <input className="input mono" value={f.personalId} onChange={set('personalId')} />
        </Field>
        <Field label={t.customer.email}>
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label={t.customer.kind}>
          <select className="input" value={f.kind} onChange={set('kind')}>
            {CUSTOMER_KINDS.map((k) => (
              <option key={k} value={k}>
                {t.customer.kinds[k]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {twin && (
        <div className="hint hint-bad">
          {t.customer.duplicate(twin.name)}{' '}
          <Link to={`/customers/${twin.id}`} className="pill pill-sm">
            {t.actions.open}
          </Link>
        </div>
      )}
      <Field label={t.customer.address}>
        <input className="input" value={f.address} onChange={set('address')} />
      </Field>
      <Field label={t.customer.tags}>
        <input className="input" value={f.tags} onChange={set('tags')} />
      </Field>
      <Field label={t.customer.notes}>
        <textarea className="input textarea" value={f.notes} onChange={set('notes')} rows={3} />
      </Field>
      {err && <div className="hint hint-bad">{err}</div>}
      <div className="row-actions">
        <button className="pill pill-accent" disabled={busy || !f.name.trim()}>
          {busy ? t.common.checking : t.actions.save}
        </button>
      </div>
    </form>
  );
}
