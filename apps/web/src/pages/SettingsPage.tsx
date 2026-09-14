import { ROLES, formatGel, parseGel, type Role } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { Empty, Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

interface Users {
  users: { id: string; name: string; email: string; role: Role; active: boolean; createdAt: string }[];
}
interface Models {
  models: { id: string; brand: string; name: string; salePriceTetri: number | null; weeklyRateTetri: number | null; costTetri: number | null; forSale: boolean; forRent: boolean; vehicles: number }[];
}

/** Everything the owner sets up by hand: who signs in, and what a moped is. */
export function SettingsPage() {
  const t = useT();
  const { me } = useSession();
  const users = useLoad<Users>('/api/users');
  const models = useLoad<Models>('/api/models');
  const [err, setErr] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, reload: () => void) => {
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <>
      <header className="page-head">
        <h1>{t.settings.title}</h1>
      </header>
      {err && <div className="hint hint-bad">{err}</div>}

      <section className="card">
        <h2>{t.settings.users}</h2>
        {!users.data ? (
          <Loading />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.users.name}</th>
                  <th>{t.users.email}</th>
                  <th>{t.users.role}</th>
                  <th>{t.users.active}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.data.users.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'row-off'}>
                    <td>{u.name}</td>
                    <td className="mono">{u.email}</td>
                    <td>
                      <select
                        className="input input-inline"
                        value={u.role}
                        onChange={(e) => void act(() => api.patch(`/api/users/${u.id}`, { role: e.target.value }), users.reload)}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t.users.roles[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{u.active ? t.common.yes : t.users.off}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="pill pill-sm"
                        onClick={() => void act(() => api.patch(`/api/users/${u.id}`, { active: !u.active }), users.reload)}
                        disabled={u.id === me?.id}
                      >
                        {u.active ? t.users.switchOff : t.users.switchOn}
                      </button>{' '}
                      <ResetPassword id={u.id} onDone={() => setErr(null)} onError={setErr} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <NewUser onDone={users.reload} onError={setErr} />
      </section>

      <section className="card">
        <h2>{t.settings.models}</h2>
        {!models.data ? (
          <Loading />
        ) : models.data.models.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.models.brand}</th>
                  <th>{t.models.name}</th>
                  <th className="num">{t.models.weeklyRate}</th>
                  <th className="num">{t.models.salePrice}</th>
                  <th className="num">{t.models.cost}</th>
                  <th>{t.models.forRent}</th>
                  <th className="num">{t.models.vehicles}</th>
                </tr>
              </thead>
              <tbody>
                {models.data.models.map((m) => (
                  <tr key={m.id}>
                    <td>{m.brand}</td>
                    <td>{m.name}</td>
                    <td className="num mono">{formatGel(m.weeklyRateTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(m.salePriceTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(m.costTetri, { decimals: false })}</td>
                    <td>{m.forRent ? t.common.yes : t.common.no}</td>
                    <td className="num mono">{m.vehicles}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <NewModel onDone={models.reload} onError={setErr} />
      </section>
    </>
  );
}

function NewUser({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', role: 'manager' as Role, password: '' });
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.settings.addUser}
      </button>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/users', f);
      setF({ name: '', email: '', role: 'manager', password: '' });
      setOpen(false);
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form sub-form" onSubmit={submit}>
      <div className="two-col">
        <Field label={t.users.name}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label={t.users.email}>
          <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        <Field label={t.users.role}>
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t.users.roles[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.users.password} hint={t.users.passwordHint}>
          <input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={8} />
        </Field>
      </div>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy}>
          {busy ? t.common.checking : t.actions.save}
        </button>
      </div>
    </form>
  );
}

function ResetPassword({ id, onDone, onError }: { id: string; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  if (!open) {
    return (
      <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
        {t.users.resetPassword}
      </button>
    );
  }
  return (
    <span className="inline-form">
      <input className="input input-inline" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} autoFocus />
      <button
        type="button"
        className="pill pill-sm pill-accent"
        disabled={pw.length < 8}
        onClick={async () => {
          try {
            await api.post(`/api/users/${id}/password`, { password: pw });
            setPw('');
            setOpen(false);
            onDone();
          } catch (e) {
            onError(errorText(e));
          }
        }}
      >
        {t.actions.save}
      </button>
    </span>
  );
}

function NewModel({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ brand: '', name: '', weeklyRate: '', salePrice: '', cost: '', forRent: true, forSale: true });
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.settings.addModel}
      </button>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/models', {
        brand: f.brand,
        name: f.name,
        weeklyRateTetri: f.weeklyRate ? parseGel(f.weeklyRate) : null,
        salePriceTetri: f.salePrice ? parseGel(f.salePrice) : null,
        costTetri: f.cost ? parseGel(f.cost) : null,
        forRent: f.forRent,
        forSale: f.forSale,
      });
      setOpen(false);
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form sub-form" onSubmit={submit}>
      <div className="two-col">
        <Field label={t.models.brand}>
          <input className="input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} required autoFocus />
        </Field>
        <Field label={t.models.name}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label={t.models.weeklyRate}>
          <input className="input input-amount mono" value={f.weeklyRate} onChange={(e) => setF({ ...f, weeklyRate: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.models.salePrice}>
          <input className="input input-amount mono" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.models.cost}>
          <input className="input input-amount mono" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={f.forRent} onChange={(e) => setF({ ...f, forRent: e.target.checked })} />
        <span>{t.models.forRent}</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={f.forSale} onChange={(e) => setF({ ...f, forSale: e.target.checked })} />
        <span>{t.models.forSale}</span>
      </label>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy}>
          {busy ? t.common.checking : t.actions.save}
        </button>
      </div>
    </form>
  );
}
