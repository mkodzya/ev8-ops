import { useState } from 'react';
import { api } from '../api.js';
import { PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { LanguageToggle, useT } from '../i18n/index.js';
import { errorText } from '../lib/use.js';
import { useSession } from '../session.js';

/** Your own login: the language and the password, nothing else. */
export function ProfilePage() {
  const t = useT();
  const { me } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setDone(false);
    try {
      await api.post('/api/me/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setDone(true);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title={t.profile.title} />
      <div className="two-col">
        <section className="card">
          <div className="kv">
            <span className="kv-k">{t.users.name}</span>
            <span className="kv-v">{me?.name}</span>
          </div>
          <div className="kv">
            <span className="kv-k">{t.users.email}</span>
            <span className="kv-v mono">{me?.email}</span>
          </div>
          <div className="kv">
            <span className="kv-k">{t.users.role}</span>
            <span className="kv-v">{me ? t.users.roles[me.role] : ''}</span>
          </div>
          <div className="kv">
            <span className="kv-k">{t.lang.label}</span>
            <span className="kv-v">
              <LanguageToggle onChange={(l) => void api.patch('/api/me/locale', { locale: l }).catch(() => {})} />
            </span>
          </div>
        </section>
        <section className="card">
          <form className="form" onSubmit={submit}>
            <Field label={t.profile.currentPassword}>
              <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label={t.profile.newPassword} hint={t.users.passwordHint}>
              <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} />
            </Field>
            {done && <div className="hint">{t.profile.changed}</div>}
            {err && <div className="hint hint-bad">{err}</div>}
            <button className="pill pill-accent" disabled={busy || !current || next.length < 8}>
              {busy ? t.common.checking : t.actions.save}
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
