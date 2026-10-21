import { PIN_MAX_DIGITS, PIN_MIN_DIGITS, localDateTime } from '@ev8/shared';
import { ChevronLeft, Delete, Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ICON } from './ds/shell/icons.js';
import { LanguageToggle, LOCALES, useLocale, useT, type Locale } from './i18n/index.js';
import { queryClient } from './lib/queryClient.js';
import { signInWithPin, type Tablet } from './lib/tablet.js';
import { errorText } from './lib/use.js';
import { forgetDeviceLeftovers, useSession } from './session.js';
import './ds/shell/tablet.css';

type Person = Tablet['people'][number];

/** A name picked and nothing typed for this long: back to the names, so the next person does not find it. */
const PICKED_IDLE_MS = 60_000;

/**
 * The workshop tablet's sign-in (ADR-0033 §6; variant А of
 * `docs/redesign/prototypes/mechanic-pin-login-options.html`, chosen by Mika
 * on 20.10.2026): a tile per mechanic who has a PIN, then a keypad with the
 * name large above it, so nobody types into somebody else's name by mistake.
 * Owners and managers sign in with their address from the link underneath.
 */
export function TabletSignIn({ tablet, onReload, onEmail, onSignedIn }: { tablet: Tablet; onReload: () => void; onEmail: () => void; onSignedIn: () => void }) {
  const t = useT();
  const [who, setWho] = useState<Person | null>(null);
  const [closed, setClosed] = useState<{ name: string; until: string } | null>(null);
  const device = tablet.device!;

  const back = useCallback(() => {
    setWho(null);
    setClosed(null);
    onReload(); // who is closed may have changed meanwhile
  }, [onReload]);

  return (
    <div className="pin-screen">
      {closed ? (
        <Closed name={closed.name} until={closed.until} onBack={back} />
      ) : who ? (
        <Keypad
          person={who}
          onBack={back}
          onClosed={(until) => setClosed({ name: who.name, until })}
          onSignedIn={onSignedIn}
          onGone={back}
        />
      ) : (
        <>
          <div className="pin-top">
            <div className="pin-brand">
              <img src="/logo.svg" alt="EV8" height={28} width={112} />
              <span className="pill-mark">ops</span>
              <span className="pin-device">· {device.name}</span>
            </div>
            <LanguageToggle />
          </div>
          {tablet.people.length === 0 ? (
            <div className="pin-head">
              <h1 className="pin-title">{t.workshop.nobody}</h1>
              <p className="pin-sub">{t.workshop.nobodyNote}</p>
            </div>
          ) : (
            <>
              <div className="pin-head">
                <h1 className="pin-title">{t.workshop.whoWorks}</h1>
                <p className="pin-sub">{t.workshop.tapName}</p>
              </div>
              <div className="pin-tiles">
                {tablet.people.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`pin-tile ${p.lockedUntil ? 'locked' : ''}`}
                    onClick={() => (p.lockedUntil ? setClosed({ name: p.name, until: p.lockedUntil }) : setWho(p))}
                  >
                    <span className="pin-ini" aria-hidden="true">
                      {p.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="pin-tile-text">
                      <span className="pin-tile-name">{p.name}</span>
                      {p.lockedUntil ? (
                        <span className="pin-tile-lock">
                          <Lock size={18} strokeWidth={2} aria-hidden="true" />
                          {t.workshop.closedUntil(localDateTime(p.lockedUntil).time)}
                        </span>
                      ) : (
                        <span className="pin-tile-role">{t.users.roles[p.role]}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="pin-foot">
            {t.workshop.ownersByEmail}{' '}
            <button type="button" className="link-btn" onClick={onEmail}>
              {t.workshop.byEmail}
            </button>
          </p>
        </>
      )}
    </div>
  );
}

/** The name large, the dots, the keys; the tablet's keyboard works too. */
function Keypad({
  person,
  onBack,
  onClosed,
  onSignedIn,
  onGone,
}: {
  person: Person;
  onBack: () => void;
  onClosed: (until: string) => void;
  onSignedIn: () => void;
  onGone: () => void;
}) {
  const t = useT();
  const { setLocale } = useLocale();
  const { refresh } = useSession();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const last = useRef(Date.now());

  const press = useCallback((d: string) => {
    last.current = Date.now();
    setMessage(null);
    setPin((p) => (p.length < PIN_MAX_DIGITS ? p + d : p));
  }, []);
  const erase = useCallback(() => {
    last.current = Date.now();
    setPin((p) => p.slice(0, -1));
  }, []);

  const submit = useCallback(async () => {
    if (busy || pin.length < PIN_MIN_DIGITS) return;
    setBusy(true);
    const answer = await signInWithPin(person.id, pin);
    setPin('');
    if (answer.ok) {
      // Whatever the last person left goes; the screen speaks this one's language.
      forgetDeviceLeftovers();
      if (LOCALES.includes(answer.locale as Locale)) setLocale(answer.locale as Locale);
      await refresh();
      void queryClient.invalidateQueries();
      onSignedIn();
      return;
    }
    setBusy(false);
    if ('closedUntil' in answer) return onClosed(answer.closedUntil);
    if ('wrong' in answer) {
      // From the third wrong one the screen says how many are left.
      setMessage(answer.left != null && answer.left <= 2 ? t.workshop.triesLeft(answer.left) : t.workshop.wrongPin);
      return;
    }
    // The tablet was revoked meanwhile, or the person switched off: back to what the tablet now shows.
    setMessage(errorText(answer.error));
    window.setTimeout(onGone, 2500);
  }, [busy, pin, person.id, setLocale, refresh, onSignedIn, onClosed, onGone, t]);

  // The tablet's own keyboard, for whoever has one plugged in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') erase();
      else if (e.key === 'Enter') void submit();
      else if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, erase, submit, onBack]);

  // A name picked and left: back to the names after a minute.
  useEffect(() => {
    const tick = window.setInterval(() => {
      if (Date.now() - last.current > PICKED_IDLE_MS) onBack();
    }, 5000);
    return () => window.clearInterval(tick);
  }, [onBack]);

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  return (
    <div className="pin-pad">
      <button type="button" className="pin-back" onClick={onBack}>
        <ChevronLeft {...ICON} aria-hidden="true" />
        {t.workshop.notMe}
      </button>
      <div className="pin-who">
        <div className="pin-who-name">{person.name}</div>
        <div className="pin-sub">{t.workshop.enterPin}</div>
      </div>
      <div className="pin-dots" aria-label={t.workshop.pin} role="status">
        {Array.from({ length: PIN_MAX_DIGITS }, (_, i) => (
          <span key={i} className={`pin-dot ${i < pin.length ? 'on' : ''} ${i >= PIN_MIN_DIGITS ? 'extra' : ''}`} />
        ))}
      </div>
      <p className={`pin-msg ${message ? 'bad' : ''}`} role="alert">
        {message ?? ''}
      </p>
      <div className="pin-keys">
        {digits.map((d) => (
          <button key={d} type="button" className="pin-key" onClick={() => press(d)} disabled={busy}>
            {d}
          </button>
        ))}
        <button type="button" className="pin-key fn" onClick={erase} disabled={busy || pin.length === 0} aria-label={t.workshop.erase}>
          <Delete size={26} strokeWidth={1.75} aria-hidden="true" />
          <span className="pin-key-word">{t.workshop.erase}</span>
        </button>
        <button type="button" className="pin-key" onClick={() => press('0')} disabled={busy}>
          0
        </button>
        <button type="button" className="pin-key go" onClick={() => void submit()} disabled={busy || pin.length < PIN_MIN_DIGITS}>
          {busy ? t.common.checking : t.common.signIn}
        </button>
      </div>
    </div>
  );
}

function Closed({ name, until, onBack }: { name: string; until: string; onBack: () => void }) {
  const t = useT();
  return (
    <div className="pin-pad pin-closed">
      <div className="pin-lockbox" role="alert">
        <p className="pin-lockbox-title">{t.workshop.closedTitle(name, localDateTime(until).time)}</p>
        <p>{t.workshop.closedNote}</p>
      </div>
      <button type="button" className="pin-back" onClick={onBack}>
        {t.workshop.backToNames}
      </button>
    </div>
  );
}
