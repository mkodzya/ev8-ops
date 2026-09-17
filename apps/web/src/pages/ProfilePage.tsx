import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { LanguageToggle, useT } from '../i18n/index.js';
import { Form } from '../ds/form/Form.js';
import { useSession } from '../session.js';

/** Your own login: the language and the password, nothing else. */
export function ProfilePage() {
  const t = useT();
  const { me, logout } = useSession();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: '', next: '' });

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
          <div className="row-actions">
            <button
              type="button"
              className="pill"
              onClick={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              {t.common.signOut}
            </button>
          </div>
        </section>
        <section className="card">
          {/* No draft: passwords are not left on a device. */}
          <Form
            value={pw}
            initial={{ current: '', next: '' }}
            label={t.profile.changePassword}
            submit={async (key) => {
              await api.post('/api/me/password', { currentPassword: pw.current, newPassword: pw.next }, { key });
              return { toast: { text: t.profile.changed } };
            }}
            onDone={() => setPw({ current: '', next: '' })}
          >
            <Field label={t.profile.currentPassword} name="currentPassword">
              <input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" />
            </Field>
            <Field label={t.profile.newPassword} hint={t.profile.passwordHint} name="newPassword">
              <input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" />
            </Field>
          </Form>
        </section>
      </div>
    </>
  );
}
