import { CUSTOMER_KINDS, type CustomerKind } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { Field } from '../components/Wizard.js';
import { PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { Form } from '../ds/form/Form.js';

/** New customer card (CST-01). A duplicate by phone or personal number is
 *  offered as a link rather than silently created twice (CST-02). */
export function CustomerForm({ onCreated, embedded }: { onCreated?: (id: string) => void; embedded?: boolean } = {}) {
  const t = useT();
  const navigate = useNavigate();
  // "New customer with this number" from the search arrives with ?phone= (wave 1 §3.5).
  const [params] = useSearchParams();
  const blank = { name: '', nameKa: '', nameLat: '', personalId: '', phone: params.get('phone') ?? '', email: '', address: '', kind: 'person' as CustomerKind, tags: '', notes: '' };
  const [f, setF] = useState(blank);
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);
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

  return (
    <>
      {!embedded && <PageHead title={t.customer.newTitle} />}
      <Form
        className={embedded ? '' : 'form-page'}
        value={f}
        initial={blank}
        draft="customer-new"
        onRestore={setF}
        summary={(v) => v.name}
        label={t.customer.create}
        submit={async (key) => {
          setTwin(null);
          try {
            const { id } = await api.post<{ id: string }>(
              '/api/customers',
              { ...f, tags: f.tags.split(',').map((x) => x.trim()).filter(Boolean) },
              { key },
            );
            return { toast: { text: t.customer.created }, created: id };
          } catch (e) {
            if (e instanceof ApiError && e.code === 'duplicate_customer') setTwin(e.extra.existing as { id: string; name: string });
            throw e;
          }
        }}
        onDone={(done) => {
          const id = done?.created;
          if (!id) return;
          if (onCreated) onCreated(id);
          else navigate(`/customers/${id}`);
        }}
      >
      <Field label={t.customer.name} name="name">
        <input className="input" value={f.name} onChange={set('name')} required autoFocus />
      </Field>
      <div className="two-col">
        <Field label={t.customer.nameKa} name="nameKa">
          <input className="input" value={f.nameKa} onChange={set('nameKa')} />
        </Field>
        <Field label={t.customer.nameLat} name="nameLat">
          <input className="input" value={f.nameLat} onChange={set('nameLat')} />
        </Field>
        <Field label={t.customer.phone} name="phone">
          <input className="input mono" value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="+995" />
        </Field>
        <Field label={t.customer.personalId} name="personalId">
          <input className="input mono" value={f.personalId} onChange={set('personalId')} />
        </Field>
        <Field label={t.customer.email} name="email">
          <input className="input" type="email" value={f.email} onChange={set('email')} />
        </Field>
        <Field label={t.customer.kind} name="kind">
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
      <Field label={t.customer.address} name="address">
        <input className="input" value={f.address} onChange={set('address')} />
      </Field>
      <Field label={t.customer.tags} name="tags">
        <input className="input" value={f.tags} onChange={set('tags')} />
      </Field>
      <Field label={t.customer.notes} name="notes">
        <textarea className="input textarea" value={f.notes} onChange={set('notes')} rows={3} />
      </Field>
      </Form>
    </>
  );
}
