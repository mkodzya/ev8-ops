import { ROLES, type Role } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';

interface Users {
  users: { id: string; name: string; email: string; role: Role; active: boolean; createdAt: string }[];
}
interface Points {
  locations: { id: string; name: string; note: string | null; sortOrder: number; archived: boolean; vehicles: number }[];
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

      <PointsBlock />
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

  return (
    <tr className={u.active ? '' : 'row-off'}>
      <td>{u.name}</td>
      <td className="mono">{u.email}</td>
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
        {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
      </td>
    </tr>
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

const blankPoint = { name: '', note: '', sortOrder: '' };

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
            await api.post('/api/locations', { name: f.name.trim(), note: f.note.trim() || null, sortOrder: f.sortOrder ? Number(f.sortOrder) : 0 }, { key });
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
