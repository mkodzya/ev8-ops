import { PIN_MAX_DIGITS, PIN_ROLES, ROLES, addDays, formatGel, gelFromTetri, localDateTime, parseGel, todayISO, type Role } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useT } from '../i18n/index.js';
import type { Dict } from '../i18n/en.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';

interface Users {
  users: {
    id: string;
    name: string;
    /** Empty for a mechanic who signs in only with a PIN (ADR-0033). */
    email: string | null;
    role: Role;
    active: boolean;
    hasPin: boolean;
    pinLockedUntil: string | null;
    labourRateTetri: number | null;
    /** A mechanic who rents a moped: his card as a customer (0066); absent while an older API answers. */
    customer?: { id: string; name: string } | null;
    sessions: number;
    lastLoginAt: string | null;
    lastSeenAt: string | null;
    createdAt: string;
  }[];
}

const isPinRole = (role: Role) => PIN_ROLES.includes(role);
interface Points {
  locations: { id: string; name: string; kind: LocationKind; note: string | null; sortOrder: number; archived: boolean; vehicles: number }[];
}

/** What a point is (B10-02). Nothing behaves differently by it yet. */
const LOCATION_KINDS = ['showroom', 'store', 'workshop', 'swap'] as const;
type LocationKind = (typeof LOCATION_KINDS)[number];

interface RentalSettings {
  depositTetri: number;
  /** The telephone on the moped stickers (migration 0043); absent while an older API answers. */
  stickerPhone?: string | null;
  quickRates: { id: string; rateTetri: number }[];
}

/** Everything the owner sets up by hand: who signs in, and what a moped is. */
export function SettingsPage() {
  const t = useT();
  const users = useLoad<Users>('/api/users');
  // A role is a set of rights, including the owner's: it changes after a
  // yes, not on a stray tap in a dropdown (B1-03).
  const [roleChange, setRoleChange] = useState<{ id: string; name: string; role: Role } | null>(null);

  return (
    <>
      <PageHead title={t.settings.title} />

      {roleChange && (
        <FormSheet
          title={t.users.confirmRoleTitle}
          onClose={() => setRoleChange(null)}
          value={roleChange.role}
          initial={roleChange.role}
          label={t.actions.confirm}
          submit={async (key) => {
            await api.patch(`/api/users/${roleChange.id}`, { role: roleChange.role }, { key });
            return { toast: { text: t.users.roleChanged(roleChange.name, t.users.roles[roleChange.role]) } };
          }}
          onDone={users.reload}
        >
          <p>{t.users.confirmRole(roleChange.name, t.users.rolesAs[roleChange.role])}</p>
        </FormSheet>
      )}

      <section className="card">
        <BlockHead title={t.settings.users} sub={users.data ? t.users.count(users.data.users.length) : undefined}>
          <NewUser onDone={users.reload} />
        </BlockHead>
        {!users.data ? (
          users.failure ? <LoadError failure={users.failure} onRetry={users.reload} /> : <Loading />
        ) : (
          <div className="table-wrap table-flat">
            {/* On a phone a person is a card and the buttons wrap (QA after issue #7): the row was wider than the screen. */}
            <table className="table people-table">
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
                  <UserRow key={u.id} user={u} onRole={(role) => setRoleChange({ id: u.id, name: u.name, role })} onDone={users.reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <WorkshopDevices />
    </>
  );
}

interface Devices {
  devices: { id: string; name: string; registeredAt: string; registeredBy: string; lastSeenAt: string | null; revokedAt: string | null; revokedBy: string | null; sessions: number; here: boolean }[];
}

/**
 * The workshop tablet (ADR-0033 §5). It is registered from the tablet itself,
 * by an owner signed in on it: the token lands in that browser's cookie and
 * nowhere else. Revoked, never deleted.
 */
function WorkshopDevices() {
  const t = useT();
  const devices = useLoad<Devices>('/api/workshop/devices');
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState(t.workshop.defaultName);
  const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
  const list = devices.data?.devices ?? [];
  const live = list.filter((d) => !d.revokedAt);
  const isHere = list.some((d) => d.here && !d.revokedAt);
  const when = (at: string) => `${localDateTime(at).date} ${localDateTime(at).time}`;

  return (
    <section className="card">
      <BlockHead title={t.workshop.devices} sub={devices.data ? t.workshop.devicesSub(live.length) : undefined}>
        {devices.data && !isHere && (
          <button type="button" className="pill pill-sm" onClick={() => setRegistering(true)}>
            {t.workshop.registerHere}
          </button>
        )}
      </BlockHead>
      {!devices.data ? (
        devices.failure ? <LoadError failure={devices.failure} onRetry={devices.reload} /> : <Loading />
      ) : list.length === 0 ? (
        <Empty text={t.workshop.devicesNone} />
      ) : (
        <div className="table-wrap table-flat">
          <table className="table">
            <tbody>
              {list.map((d) => (
                <tr key={d.id} className={d.revokedAt ? 'row-off' : ''}>
                  <td>
                    {d.name}
                    {d.here && <span className="muted"> · {t.workshop.here}</span>}
                    <div className="hint muted">
                      {t.workshop.registeredBy(d.registeredBy, when(d.registeredAt))}
                      {d.lastSeenAt && ` · ${t.workshop.lastSeen(when(d.lastSeenAt))}`}
                      {d.revokedAt && d.revokedBy && ` · ${t.workshop.revokedAt(d.revokedBy, when(d.revokedAt))}`}
                    </div>
                  </td>
                  <td className="num">{!d.revokedAt && d.sessions > 0 && <span className="muted">{t.workshop.sessionsNow(d.sessions)}</span>}</td>
                  <td className="num">
                    {!d.revokedAt && (
                      <button type="button" className="pill pill-sm" onClick={() => setRevoking({ id: d.id, name: d.name })}>
                        {t.workshop.revoke}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {registering && (
        <FormSheet
          title={t.workshop.registerTitle}
          onClose={() => setRegistering(false)}
          value={name}
          initial={t.workshop.defaultName}
          label={t.workshop.registerHere}
          submit={async (key) => {
            await api.post('/api/workshop/devices', { name }, { key });
            return { toast: { text: t.workshop.registered(name) } };
          }}
          onDone={devices.reload}
        >
          <p className="hint">{t.workshop.registerNote}</p>
          <Field label={t.workshop.deviceName} name="name">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        </FormSheet>
      )}

      {revoking && (
        <FormSheet
          title={t.workshop.revokeTitle}
          onClose={() => setRevoking(null)}
          value={revoking.id}
          initial={revoking.id}
          label={t.workshop.revokeButton}
          submit={async (key) => {
            await api.post(`/api/workshop/devices/${revoking.id}/revoke`, {}, { key });
            return { toast: { text: t.workshop.revoked(revoking.name) } };
          }}
          onDone={devices.reload}
        >
          <p>{t.workshop.revokeConfirm(revoking.name)}</p>
        </FormSheet>
      )}
    </section>
  );
}

/**
 * Settings → Rental (wave 6 §3.5, R5): the figures a hand-over proposes, an
 * owner's to set rather than a developer's.
 */
export function RentalSettingsPage() {
  const t = useT();
  return (
    <>
      <PageHead title={t.settings.title} />
      <RentalBlock />
    </>
  );
}

/**
 * Settings → Sign-in (wave 6 §3.9, B9-03). Every figure comes from the
 * server, which reads it from the code: these are rules, not settings, and a
 * screen keeping its own copy of a rule is a screen that will disagree with
 * it one day.
 */
export function LoginSettingsPage() {
  const t = useT();
  const rules = useLoad<{
    sessionDays: number;
    idleDays: number;
    maxAttempts: number;
    demoLoginsRefused: boolean;
    /** Absent while an older API answers. */
    pin?: { minDigits: number; maxDigits: number; maxFailures: number; lockMinutes: number; idleMinutes: number };
  }>('/api/settings/login');
  return (
    <>
      <PageHead title={t.loginSettings.title} sub={t.loginSettings.subtitle} />
      <section className="card">
        {!rules.data ? (
          rules.failure ? <LoadError failure={rules.failure} onRetry={rules.reload} /> : <Loading />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <tbody>
                <tr>
                  <td>{t.loginSettings.sessionTtl}</td>
                  <td className="num">{t.loginSettings.sessionTtlValue(rules.data.sessionDays)}</td>
                </tr>
                <tr>
                  <td>{t.loginSettings.idle}</td>
                  <td className="num">{t.loginSettings.idleValue(rules.data.idleDays)}</td>
                </tr>
                <tr>
                  <td>
                    {t.loginSettings.attempts}
                    <div className="hint muted">{t.loginSettings.attemptsNote}</div>
                  </td>
                  <td className="num">{t.loginSettings.attemptsValue(rules.data.maxAttempts)}</td>
                </tr>
                <tr>
                  <td>{t.loginSettings.demo}</td>
                  <td className="num">{rules.data.demoLoginsRefused ? t.loginSettings.demoOff : t.common.dash}</td>
                </tr>
                {rules.data.pin && (
                  <>
                    <tr>
                      <td>{t.workshop.pinRule}</td>
                      <td className="num">{t.workshop.pinRuleValue(rules.data.pin.minDigits, rules.data.pin.maxDigits)}</td>
                    </tr>
                    <tr>
                      <td>{t.workshop.pinLockRule}</td>
                      <td className="num">{t.workshop.pinLockRuleValue(rules.data.pin.maxFailures, rules.data.pin.lockMinutes)}</td>
                    </tr>
                    <tr>
                      <td>{t.workshop.pinIdleRule}</td>
                      <td className="num">{t.workshop.pinIdleRuleValue(rules.data.pin.idleMinutes)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint muted">{t.loginSettings.ownPassword}</p>
      </section>
    </>
  );
}

/** One person: each row keeps its own refusal, so one person's error never shows on another's (QA-1-06). */
function UserRow({ user: u, onRole, onDone }: { user: Users['users'][number]; onRole: (role: Role) => void; onDone: () => void }) {
  const t = useT();
  const { me } = useSession();
  const toast = useToast();
  const op = useOperation();
  // One thing typed at a time in a row: a password, a PIN or a rate (ADR-0033).
  const [editing, setEditing] = useState<'password' | 'pin' | 'rate' | 'renter' | null>(null);
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [rate, setRate] = useState('');
  const [renter, setRenter] = useState('');
  const mechanic = isPinRole(u.role);
  // The customers to pick the mechanic's own card from — read only while the picker is open.
  const customers = useLoad<{ customers: { id: string; name: string; openRentals: { number: string }[] }[] }>(editing === 'renter' ? '/api/customers' : null);
  // Only a card with a rental running has rent to pay, and the card linked now stays on the list to be seen.
  const renters = (customers.data?.customers ?? []).filter((c) => c.openRentals.length > 0 || c.id === u.customer?.id);

  const stopEditing = () => {
    setEditing(null);
    setPw('');
    setEmail('');
    setPin('');
    setRate('');
    setRenter('');
    op.reset();
  };
  const toggle = async () => {
    const res = await op.run((key) => api.patch(`/api/users/${u.id}`, { active: !u.active }, { key }), `active:${!u.active}`);
    if (!res.ok) return;
    toast({ text: u.active ? t.users.switchedOff(u.name) : t.users.switchedOn(u.name) });
    onDone();
  };
  const reset = async () => {
    // Somebody who had only a PIN gets an address with their first password.
    const body = u.email ? { password: pw } : { email, password: pw };
    const res = await op.run((key) => api.post(`/api/users/${u.id}/password`, body, { key }), 'password');
    if (!res.ok) return;
    stopEditing();
    toast({ text: u.email ? t.users.passwordSet(u.name) : t.workshop.passwordSetWithEmail(u.name) });
    onDone();
  };
  /** The PIN goes to the server and nowhere else: not to a draft, not back into the row. */
  const savePin = async () => {
    const res = await op.run((key) => api.post(`/api/users/${u.id}/pin`, { pin }, { key }), 'pin');
    if (!res.ok) return;
    stopEditing();
    toast({ text: t.workshop.pinSet(u.name) });
    onDone();
  };
  const clearPin = async () => {
    const res = await op.run((key) => api.del(`/api/users/${u.id}/pin`, { key }), 'pin:clear');
    if (!res.ok) return;
    toast({ text: t.workshop.pinCleared(u.name) });
    op.reset();
    onDone();
  };
  const saveRate = async () => {
    const res = await op.run((key) => api.patch(`/api/users/${u.id}`, { labourRateTetri: rate.trim() === '' ? null : rate }, { key }), 'rate');
    if (!res.ok) return;
    stopEditing();
    toast({ text: t.workshop.rateSaved(u.name) });
    onDone();
  };
  /** A mechanic who rents a moped: his payouts pay that customer's rent first (0066). Empty unlinks. */
  const saveRenter = async () => {
    const res = await op.run((key) => api.patch(`/api/users/${u.id}`, { customerId: renter === '' ? null : renter }, { key }), `renter:${renter}`);
    if (!res.ok) return;
    stopEditing();
    toast({ text: renter === '' ? t.wpay.renterCleared(u.name) : t.wpay.renterSaved(u.name) });
    onDone();
  };
  /** A phone left somewhere: every device signs in again, the password stays theirs (§3.4). */
  const closeSessions = async () => {
    const res = await op.run((key) => api.post<{ closed: number }>(`/api/users/${u.id}/sessions/close`, {}, { key }), 'sessions');
    if (!res.ok) return;
    toast({ text: res.value.closed > 0 ? t.peopleW6.sessionsClosed(u.name, res.value.closed) : t.peopleW6.noSessions(u.name) });
    op.reset();
    onDone();
  };

  return (
    <tr className={u.active ? '' : 'row-off'}>
      <td>
        {u.name}
        {/* A mechanic's PIN and rate, never the PIN itself (ADR-0033). */}
        {mechanic && (
          <div className="hint muted">
            {u.pinLockedUntil ? (
              <span className="crit-text">{t.workshop.pinLockedUntil(localDateTime(u.pinLockedUntil).time)}</span>
            ) : u.hasPin ? (
              t.workshop.hasPin
            ) : (
              t.workshop.noPin
            )}
            {' · '}
            {u.labourRateTetri != null ? t.workshop.rateValue(formatGel(u.labourRateTetri)) : t.workshop.rateCompany}
            {u.customer && ` · ${t.wpay.renter}: ${u.customer.name}`}
          </div>
        )}
      </td>
      <td className="mono">
        {u.email ?? <span className="muted">{t.workshop.pinOnly}</span>}
        {/* When this person was last seen, and on how many devices: the two
            things "Закрыть все входы" is decided by. */}
        <div className="hint muted">
          {/* When they last signed in, from the journal — a closed session
              takes its own history with it (QA-W6-14). "Нет данных" where
              the sign-in is older than the journal, never "не входил". */}
          {u.lastLoginAt ? t.peopleW6.lastSeen(lastSeenWords(t, u.lastLoginAt)) : t.peopleW6.neverSeen}
          {u.sessions > 0 && ` · ${t.peopleW6.signedInNow(u.sessions)}`}
        </div>
      </td>
      <td>
        <select className="input input-inline" value={u.role} onChange={(e) => onRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t.users.roles[r]}
            </option>
          ))}
        </select>
      </td>
      {/* «Да» says nothing on a phone's card, where there is no heading over it: there only «Отключён» is written. */}
      <td className={u.active ? 'people-on' : undefined}>{u.active ? t.common.yes : t.users.off}</td>
      <td className="num people-acts">
        {editing === 'password' ? (
          <span className="inline-form">
            {!u.email && (
              <input className="input input-inline" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder={t.users.email} aria-label={t.users.email} />
            )}
            <input className="input input-inline" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus={!!u.email} aria-label={t.users.password} placeholder={t.users.password} />
            <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void reset()} />
            <button type="button" className="pill pill-sm" onClick={stopEditing}>
              {t.actions.cancel}
            </button>
          </span>
        ) : editing === 'pin' ? (
          <span className="inline-form">
            <input
              className="input input-inline mono"
              inputMode="numeric"
              autoComplete="off"
              maxLength={PIN_MAX_DIGITS}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              autoFocus
              aria-label={t.workshop.pin}
              title={t.workshop.pinHint}
            />
            <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void savePin()} />
            <button type="button" className="pill pill-sm" onClick={stopEditing}>
              {t.actions.cancel}
            </button>
          </span>
        ) : editing === 'rate' ? (
          <span className="inline-form">
            <input className="input input-inline mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} autoFocus aria-label={t.workshop.rate} title={t.workshop.rateHint} />
            <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void saveRate()} />
            <button type="button" className="pill pill-sm" onClick={stopEditing}>
              {t.actions.cancel}
            </button>
          </span>
        ) : editing === 'renter' ? (
          <>
            <span className="inline-form">
              <select className="input input-inline" value={renter} onChange={(e) => setRenter(e.target.value)} autoFocus aria-label={t.wpay.renterPick} aria-describedby={`renter-hint-${u.id}`}>
                <option value="">{t.wpay.renterNone}</option>
                {renters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {[c.name, ...c.openRentals.map((r) => r.number)].join(' · ')}
                  </option>
                ))}
              </select>
              <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void saveRenter()} />
              <button type="button" className="pill pill-sm" onClick={stopEditing}>
                {t.actions.cancel}
              </button>
            </span>
            {/* What the link does, as text: a select's title is never seen on a phone (QA after issue #7). */}
            <p className="hint muted people-hint" id={`renter-hint-${u.id}`}>
              {t.wpay.renterHint}
            </p>
          </>
        ) : (
          <>
            <button type="button" className="pill pill-sm" onClick={() => void toggle()} disabled={u.id === me?.id || op.state === 'busy'}>
              {u.active ? t.users.switchOff : t.users.switchOn}
            </button>{' '}
            <button type="button" className="pill pill-sm" onClick={() => setEditing('password')}>
              {u.email ? t.users.resetPassword : t.workshop.giveEmail}
            </button>{' '}
            {mechanic && (
              <>
                <button type="button" className="pill pill-sm" title={t.workshop.pinHint} onClick={() => setEditing('pin')}>
                  {u.hasPin ? t.workshop.newPin : t.workshop.setPin}
                </button>{' '}
                {u.hasPin && (
                  <>
                    <button type="button" className="pill pill-sm" onClick={() => void clearPin()} disabled={op.state === 'busy'}>
                      {t.workshop.clearPin}
                    </button>{' '}
                  </>
                )}
                <button
                  type="button"
                  className="pill pill-sm"
                  title={t.workshop.rateHint}
                  onClick={() => {
                    setRate(u.labourRateTetri != null ? String(gelFromTetri(u.labourRateTetri)) : '');
                    setEditing('rate');
                  }}
                >
                  {t.workshop.rate}
                </button>{' '}
                <button
                  type="button"
                  className="pill pill-sm"
                  title={t.wpay.renterHint}
                  onClick={() => {
                    setRenter(u.customer?.id ?? '');
                    setEditing('renter');
                  }}
                >
                  {t.wpay.renter}
                </button>{' '}
              </>
            )}
            <button type="button" className="pill pill-sm" title={t.peopleW6.closeSessionsHint} onClick={() => void closeSessions()} disabled={op.state === 'busy'}>
              {t.peopleW6.closeSessions}
            </button>
          </>
        )}
        {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
      </td>
    </tr>
  );
}

/**
 * "вход сегодня 09:12" / "вход вчера" / a date, as the prototype says it —
 * and all of it on the company's clock, not the reader's (QA-W6-18). For an
 * owner in London, "сегодня" means the day it is in Tbilisi, because that is
 * the day the business had.
 */
function lastSeenWords(t: Dict, at: string): string {
  const seen = localDateTime(at);
  const day = seen.date.split('.').reverse().join('-');
  const today = todayISO();
  if (day === today) return `${t.peopleW6.today} ${seen.time}`;
  if (day === addDays(today, -1)) return t.peopleW6.yesterday;
  return seen.date;
}

/**
 * Rental — the figures a hand-over proposes (wave 6 §3.5, R5).
 *
 * The model's own rate still goes in first; these are the buttons beside it.
 * A rate taken off the buttons is archived, never deleted: a rental written
 * at 140 ₾ has to keep reading 140 ₾.
 */
export function RentalBlock() {
  const t = useT();
  const settings = useLoad<RentalSettings>('/api/settings/rental');
  const toast = useToast();
  const op = useOperation();
  const [adding, setAdding] = useState(false);
  const [rate, setRate] = useState('');
  const [deposit, setDeposit] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  if (!settings.data) {
    return settings.failure ? <LoadError failure={settings.failure} onRetry={settings.reload} /> : <Loading />;
  }
  const s = settings.data;
  const depositText = deposit ?? String(gelFromTetri(s.depositTetri));

  const saveDeposit = async () => {
    const parsed = parseGel(depositText);
    if (parsed == null || parsed === s.depositTetri) {
      setDeposit(null);
      return;
    }
    const res = await op.run((key) => api.patch('/api/settings/rental', { depositTetri: depositText }, { key }), `deposit:${depositText}`);
    if (!res.ok) return;
    setDeposit(null);
    toast({ text: t.rentalSettings.depositSaved(formatGel(parsed)) });
    settings.reload();
  };

  const phoneText = phone ?? s.stickerPhone ?? '';
  const savePhone = async () => {
    if (phone == null || phone.trim() === (s.stickerPhone ?? '')) {
      setPhone(null);
      return;
    }
    const res = await op.run((key) => api.patch('/api/settings/sticker', { stickerPhone: phone.trim() }, { key }), `sticker:${phone}`);
    if (!res.ok) return;
    setPhone(null);
    toast({ text: t.form.changesSaved });
    settings.reload();
  };

  const addRate = async () => {
    const res = await op.run((key) => api.post('/api/settings/rates', { rateTetri: rate }, { key }), `rate:${rate}`);
    if (!res.ok) return;
    setRate('');
    setAdding(false);
    settings.reload();
  };

  const removeRate = async (id: string) => {
    const res = await op.run((key) => api.del(`/api/settings/rates/${id}`, { key }), `off:${id}`);
    if (res.ok) settings.reload();
  };

  return (
    <section className="card">
      <BlockHead title={t.settings.rental} note={t.rentalSettings.hint} />
      <Field label={t.rentalSettings.rates} hint={t.rentalSettings.ratesHint} name="rates">
        <div className="chips">
          {s.quickRates.map((r) => (
            <span key={r.id} className="pill pill-sm">
              <span className="mono">{formatGel(r.rateTetri, { decimals: false })}</span>{' '}
              <button type="button" className="pill pill-sm" aria-label={t.rentalSettings.removeRate} disabled={op.state === 'busy'} onClick={() => void removeRate(r.id)}>
                ×
              </button>
            </span>
          ))}
          {adding ? (
            <>
              <input
                className="input input-amount mono"
                inputMode="decimal"
                autoFocus
                value={rate}
                aria-label={t.rentalSettings.rates}
                onChange={(e) => setRate(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addRate()}
              />
              <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void addRate()} />
            </>
          ) : (
            <button type="button" className="pill pill-sm" onClick={() => setAdding(true)}>
              + {t.rentalSettings.addRate}
            </button>
          )}
        </div>
      </Field>
      <Field label={t.rentalSettings.deposit} hint={t.rentalSettings.depositHint} name="depositTetri">
        <input
          className="input input-amount mono"
          inputMode="decimal"
          value={depositText}
          aria-label={t.rentalSettings.deposit}
          onChange={(e) => setDeposit(e.target.value)}
          onBlur={() => void saveDeposit()}
        />
      </Field>
      <Field label={t.rentalSettings.stickerPhone} hint={t.rentalSettings.stickerPhoneHint} name="stickerPhone">
        <input className="input mono" inputMode="tel" value={phoneText} aria-label={t.rentalSettings.stickerPhone} onChange={(e) => setPhone(e.target.value)} onBlur={() => void savePhone()} />
      </Field>
      {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
    </section>
  );
}

/**
 * Points — the company's own words for its places. Lives in Settings and,
 * for the owner, as the "Points" tab of the fleet (wave 1 §3.2).
 */
export function PointsBlock() {
  const t = useT();
  const points = useLoad<Points>('/api/locations?all=1');
  return (
    <>
      {/* Points. The list is the company's own words for its places, so it
          starts empty on purpose: a seeded "Warehouse" nobody says out loud
          would be the first wrong answer in the fleet. */}
      <section className="card">
        <BlockHead title={t.settings.points} sub={points.data ? t.points.count(points.data.locations.length) : undefined} note={t.points.hint}>
          <NewPoint onDone={points.reload} />
        </BlockHead>
        {!points.data ? (
          points.failure ? <LoadError failure={points.failure} onRetry={points.reload} /> : <Loading />
        ) : points.data.locations.length === 0 ? (
          <Empty text={t.points.empty} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.points.name}</th>
                  <th>{t.points.kind}</th>
                  <th>{t.points.note}</th>
                  <th className="num">{t.points.order}</th>
                  <th className="num">{t.points.vehicles}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {points.data.locations.map((l) => (
                  <PointRow key={l.id} point={l} onDone={points.reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** A point's name and note are corrected in place, saved when the field loses focus; its refusal stays in its row. */
function PointRow({ point: l, onDone }: { point: Points['locations'][number]; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [name, setName] = useState(l.name);
  const [note, setNote] = useState(l.note ?? '');

  const save = async (field: 'name' | 'note', v: string, was: string, undo: (v: string) => void) => {
    if (v.trim() === was.trim()) return;
    const res = await op.run((key) => api.patch(`/api/locations/${l.id}`, { [field]: v.trim() }, { key }), `${field}:${v.trim()}`);
    if (!res.ok) {
      undo(was);
      return;
    }
    onDone();
  };
  const saveKind = async (kind: LocationKind) => {
    if (kind === l.kind) return;
    const res = await op.run((key) => api.patch(`/api/locations/${l.id}`, { kind }, { key }), `kind:${kind}`);
    if (res.ok) onDone();
  };
  const archive = async () => {
    const res = await op.run((key) => api.patch(`/api/locations/${l.id}`, { archived: !l.archived }, { key }), `archived:${!l.archived}`);
    if (!res.ok) return;
    toast({
      text: l.archived ? t.points.restored(l.name) : t.points.archived(l.name),
      undo: async () => {
        await api.patch(`/api/locations/${l.id}`, { archived: l.archived });
        onDone();
      },
    });
    onDone();
  };

  return (
    <tr className={l.archived ? 'row-off' : ''}>
      <td>
        <input className="input input-inline" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void save('name', name, l.name, setName)} aria-label={t.points.name} />
        {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
      </td>
      <td>
        {/* A kind is corrected in place like a name; nothing behaves
            differently by it yet (B10-02). */}
        <select
          className="input input-inline"
          value={l.kind}
          aria-label={t.points.kind}
          disabled={op.state === 'busy'}
          onChange={(e) => void saveKind(e.target.value as LocationKind)}
        >
          {LOCATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.points.kinds[k]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input className="input input-inline" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void save('note', note, l.note ?? '', setNote)} aria-label={t.points.note} />
      </td>
      <td className="num mono">{l.sortOrder}</td>
      <td className="num mono">{l.vehicles}</td>
      <td className="num">
        <button type="button" className="pill pill-sm" disabled={op.state === 'busy'} onClick={() => void archive()}>
          {l.archived ? t.points.restore : t.points.archive}
        </button>
      </td>
    </tr>
  );
}

const blankUser = { name: '', email: '', role: 'manager' as Role, password: '', pin: '' };

function NewUser({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blankUser);
  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.settings.addUser}
      </button>
      {open && (
        // No draft: the form holds a password, and a password is not left on a device.
        <FormSheet
          title={t.settings.addUser}
          onClose={() => setOpen(false)}
          value={f}
          initial={blankUser}
          label={t.users.create}
          submit={async (key) => {
            // A mechanic may come without an address and with a PIN instead (ADR-0033 §8).
            const { pin, ...person } = f;
            const body = isPinRole(f.role) && person.email.trim() === '' ? { name: person.name, role: person.role } : person;
            const { id } = await api.post<{ id: string }>('/api/users', body, { key });
            if (isPinRole(f.role) && pin !== '') await api.post(`/api/users/${id}/pin`, { pin });
            return { toast: { text: t.users.created(f.name) } };
          }}
          onDone={() => {
            setF(blankUser);
            onDone();
          }}
        >
          <div className="two-col">
            <Field label={t.users.name} name="name">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t.users.email} name="email">
              <input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            </Field>
            <Field label={t.users.role} name="role">
              <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t.users.roles[r]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.users.password} hint={t.users.passwordHint} name="password">
              <input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
            {isPinRole(f.role) && (
              <Field label={t.workshop.pin} hint={t.workshop.pinHint} name="pin">
                <input
                  className="input mono"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={PIN_MAX_DIGITS}
                  value={f.pin}
                  onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '') })}
                />
              </Field>
            )}
          </div>
          {isPinRole(f.role) && <p className="hint muted">{t.workshop.emailOptional}</p>}
        </FormSheet>
      )}
    </>
  );
}

const blankPoint = { name: '', kind: 'showroom' as LocationKind, note: '', sortOrder: '' };

function NewPoint({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(blankPoint);
  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.settings.addPoint}
      </button>
      {open && (
        <FormSheet
          title={t.settings.addPoint}
          onClose={() => setOpen(false)}
          value={f}
          initial={blankPoint}
          draft="point-new"
          onRestore={setF}
          summary={(v) => v.name}
          label={t.points.create}
          submit={async (key) => {
            await api.post('/api/locations', { name: f.name.trim(), kind: f.kind, note: f.note.trim() || null, sortOrder: f.sortOrder ? Number(f.sortOrder) : 0 }, { key });
            return { toast: { text: t.points.created(f.name.trim()) } };
          }}
          onDone={() => {
            setF(blankPoint);
            onDone();
          }}
        >
          <div className="two-col">
            {/* The section already says what a point is; saying it twice under
                the field is noise. */}
            <Field label={t.points.name} name="name">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} autoFocus />
            </Field>
            <Field label={t.points.kind} hint={t.points.kindHint} name="kind">
              <select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LocationKind })}>
                {LOCATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t.points.kinds[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.points.note} hint={t.points.noteHint} name="note">
              <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} />
            </Field>
            <Field label={t.points.order} name="sortOrder">
              <input className="input input-amount mono" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
        </FormSheet>
      )}
    </>
  );
}
