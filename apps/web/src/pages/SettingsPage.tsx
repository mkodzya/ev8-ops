import { ROLES, addDays, formatGel, gelFromTetri, localDateTime, parseGel, todayISO, type Role } from '@ev8/shared';
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
  users: { id: string; name: string; email: string; role: Role; active: boolean; sessions: number; lastLoginAt: string | null; lastSeenAt: string | null; createdAt: string }[];
}
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
                  <UserRow key={u.id} user={u} onRole={(role) => setRoleChange({ id: u.id, name: u.name, role })} onDone={users.reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

    </>
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
  const rules = useLoad<{ sessionDays: number; idleDays: number; maxAttempts: number; demoLoginsRefused: boolean }>('/api/settings/login');
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
  const [resetting, setResetting] = useState(false);
  const [pw, setPw] = useState('');

  const toggle = async () => {
    const res = await op.run((key) => api.patch(`/api/users/${u.id}`, { active: !u.active }, { key }), `active:${!u.active}`);
    if (!res.ok) return;
    toast({ text: u.active ? t.users.switchedOff(u.name) : t.users.switchedOn(u.name) });
    onDone();
  };
  const reset = async () => {
    const res = await op.run((key) => api.post(`/api/users/${u.id}/password`, { password: pw }, { key }), 'password');
    if (!res.ok) return;
    setPw('');
    setResetting(false);
    op.reset();
    toast({ text: t.users.passwordSet(u.name) });
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
      <td>{u.name}</td>
      <td className="mono">
        {u.email}
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
      <td>{u.active ? t.common.yes : t.users.off}</td>
      <td className="num">
        <button type="button" className="pill pill-sm" onClick={() => void toggle()} disabled={u.id === me?.id || op.state === 'busy'}>
          {u.active ? t.users.switchOff : t.users.switchOn}
        </button>{' '}
        {!resetting ? (
          <button type="button" className="pill pill-sm" onClick={() => setResetting(true)}>
            {t.users.resetPassword}
          </button>
        ) : (
          <span className="inline-form">
            <input className="input input-inline" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus aria-label={t.users.password} />
            <SubmitButton small type="button" state={op.state} label={t.actions.save} onClick={() => void reset()} />
          </span>
        )}
        {!resetting && (
          <>
            {' '}
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

const blankUser = { name: '', email: '', role: 'manager' as Role, password: '' };

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
            await api.post('/api/users', f, { key });
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
          </div>
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
