import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api.js';
import { LanguageToggle, useT } from './i18n/index.js';
import { useSession } from './session.js';

export function LoginPage() {
  const navigate = useNavigate();
  const { me, loading, refresh } = useSession();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && me) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t.common.loginFailed : (err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <picture>
            <source srcSet="/logo-light.svg" media="(prefers-color-scheme: dark)" />
            <img src="/logo.svg" alt="EV8" height={28} width={112} />
          </picture>
          <span className="pill-mark">ops</span>
        </div>
        <div className="login-lang">
          <LanguageToggle />
        </div>
        <p className="login-note">{t.login.note}</p>
        <label className="field">
          <span className="lbl">{t.common.email}</span>
          <input className="input" type="email" value={email} autoFocus autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="lbl">{t.common.password}</span>
          <input className="input" type="password" value={password} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="hint hint-bad">{error}</div>}
        <button className="pill pill-accent pill-wide" disabled={busy || !email || !password}>
          {busy ? t.common.checking : t.common.signIn}
        </button>
      </form>
    </div>
  );
}
