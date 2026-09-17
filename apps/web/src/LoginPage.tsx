import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api.js';
import { LanguageToggle, useT } from './i18n/index.js';
import { errorText } from './lib/use.js';
import { useSession } from './session.js';

export function LoginPage() {
  const navigate = useNavigate();
  // Where the person was when the session ended; home when they came here first.
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const { me, loading, refresh } = useSession();
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && me) return <Navigate to={from} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t.common.loginFailed : errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-head">
          <img src="/logo.svg" alt="EV8" height={28} width={112} />
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
