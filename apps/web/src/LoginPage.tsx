import { useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api.js';
import { useHeader } from './ds/shell/header.js';
import { LanguageToggle, useT } from './i18n/index.js';
import { queryClient } from './lib/queryClient.js';
import { errorText } from './lib/use.js';
import { useSession } from './session.js';

export function LoginPage() {
  const navigate = useNavigate();
  // Where the person was when the session ended; home when they came here first.
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/';
  const { me, loading, signedOutOffline, dismissOffline } = useSession();
  const t = useT();

  if (!loading && me) return <Navigate to={from} replace />;

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <img src="/logo.svg" alt="EV8" height={28} width={112} />
          <span className="pill-mark">ops</span>
        </div>
        <div className="login-lang">
          <LanguageToggle />
        </div>
        {signedOutOffline ? (
          <SignedOutOffline onDismiss={dismissOffline} />
        ) : (
          <>
            <p className="login-note">{t.login.note}</p>
            <LoginForm onSignedIn={() => navigate(from, { replace: true })} />
          </>
        )}
      </div>
    </div>
  );
}

/** Said honestly, once: the phone forgot the sign-in, the server has not heard yet (QA-1-01). */
export function SignedOutOffline({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="login-offline" role="status">
      <p className="t-h3">{t.session.signedOutHere}</p>
      <p className="login-note">{t.session.serverLater}</p>
      <button type="button" className="pill pill-accent pill-wide" onClick={onDismiss}>
        {t.session.understood}
      </button>
    </div>
  );
}

/** Email, password, sign in — on the login page and over a page whose session ended. */
export function LoginForm({ email: knownEmail = '', onSignedIn }: { email?: string; onSignedIn: () => void }) {
  const t = useT();
  const { refresh } = useSession();
  const [email, setEmail] = useState(knownEmail);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refresh();
      // Everything on screen was read under the old session, or failed without one.
      void queryClient.invalidateQueries();
      onSignedIn();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t.common.loginFailed : errorText(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label className="field">
        <span className="lbl">{t.common.email}</span>
        <input className="input" type="email" value={email} autoFocus={!knownEmail} autoComplete="username" onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span className="lbl">{t.common.password}</span>
        <input className="input" type="password" value={password} autoFocus={!!knownEmail} autoComplete="current-password" onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className="form-banner form-banner-bad" role="alert">{error}</div>}
      <button className="pill pill-accent pill-wide" disabled={busy || !email || !password}>
        {busy ? t.common.checking : t.common.signIn}
      </button>
    </form>
  );
}

/**
 * The session ended while a page was open (wave 1 §3.8, "Сессия закончилась"):
 * the sign-in comes over the page, which stays mounted with whatever was typed
 * into it, and signing in returns to it as it was.
 */
export function SessionEnded() {
  const t = useT();
  const { ended } = useSession();
  const header = useHeader();
  if (!ended) return null;
  return (
    <div className="session-ended" role="dialog" aria-modal="true" aria-label={t.session.ended}>
      <SessionEndedCard title={header?.title} email={ended.email} />
    </div>
  );
}

export function SessionEndedCard({ title, email }: { title?: ReactNode; email: string }) {
  const t = useT();
  return (
    <div className="login-card">
      <p className="t-h3">{t.session.ended}</p>
      <p className="login-note">
        {title ? (
          <>
            {t.session.signInAgainTo} «{title}», {t.session.typedKept}
          </>
        ) : (
          t.session.signInAgain
        )}
      </p>
      <LoginForm email={email} onSignedIn={() => {}} />
    </div>
  );
}
