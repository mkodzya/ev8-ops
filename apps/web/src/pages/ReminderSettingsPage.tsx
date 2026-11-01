import { REMINDER_TEMPLATES, type ReminderBotKey, type ReminderSendMode, type ReminderTemplate } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDateAt } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

// Settings → Reminders (issue #20, ADR-0053): how far this stand sends the
// rent reminders through Kommo, and the owner's side of it — a pause that
// stops sending at once, the six Kommo bots (a template and a language each)
// and the test deals a stand in test mode sends to. The mode itself is the
// stand's and is changed on the server, never here: the test stand holds a
// copy of production's customers. Each field saves when it is left, the way
// Settings → Repair does, and the journal keeps every change.

interface ReminderSettings {
  sendMode: ReminderSendMode;
  kommo: boolean;
  paused: boolean;
  bots: Record<ReminderBotKey, number | null>;
  testLeads: string[];
  amountField: string;
  templates: Record<ReminderTemplate, string>;
  today: Partial<Record<'dry_run' | 'sending' | 'sent' | 'failed', number>>;
  updatedAt: string;
  updatedBy: string | null;
}

const LANGS = ['ka', 'en'] as const;

export function ReminderSettingsPage() {
  const t = useT();
  const r = t.rem.set;
  const settings = useLoad<ReminderSettings>('/api/settings/reminders');
  const toast = useToast();
  const op = useOperation();
  const [typed, setTyped] = useState<Partial<Record<ReminderBotKey | 'testLeads', string>>>({});

  if (!settings.data) {
    return settings.failure ? <LoadError failure={settings.failure} onRetry={settings.reload} /> : <Loading />;
  }
  const s = settings.data;
  const leadsText = s.testLeads.join(', ');

  const save = async (key: ReminderBotKey | 'testLeads') => {
    const text = typed[key];
    if (text == null) return;
    const was = key === 'testLeads' ? leadsText : s.bots[key] == null ? '' : String(s.bots[key]);
    if (text.trim() === was) {
      setTyped((x) => ({ ...x, [key]: undefined }));
      return;
    }
    const body = key === 'testLeads' ? { testLeads: text } : { bots: { [key]: text.trim() } };
    const res = await op.run((k) => api.patch('/api/settings/reminders', body, { key: k }), `${key}:${text}`);
    if (!res.ok) return;
    setTyped((x) => ({ ...x, [key]: undefined }));
    toast({ text: r.saved });
    settings.reload();
  };

  const pause = async (paused: boolean) => {
    const res = await op.run((k) => api.patch('/api/settings/reminders', { paused }, { key: k }), `paused:${paused}`);
    if (!res.ok) return;
    toast({ text: paused ? r.pausedDone : r.resumedDone });
    settings.reload();
  };

  return (
    <>
      <PageHead title={t.settings.title} />
      <section className="card">
        <BlockHead title={r.mode}>
          <button type="button" className="pill pill-sm" disabled={op.state === 'busy'} onClick={() => void pause(!s.paused)}>
            {s.paused ? r.resume : r.pause}
          </button>
        </BlockHead>
        <p>
          <b>{r.modes[s.sendMode]}</b>
        </p>
        <p className="hint muted">{r.modeHint}</p>
        {s.paused && <p className="warn-text">{r.paused}</p>}
        {!s.kommo && s.sendMode !== 'off' && <p className="warn-text">{r.noKommo}</p>}
        <p className="hint">{r.field(s.amountField)}</p>
        <p>
          <span className="lbl">{r.today}: </span>
          {r.counts(s.today.sent ?? 0, s.today.failed ?? 0, s.today.dry_run ?? 0)}
        </p>
      </section>

      <section className="card">
        <BlockHead title={r.bots} />
        <p className="hint muted">{r.botsHint}</p>
        {REMINDER_TEMPLATES.map((tpl) =>
          LANGS.map((lang) => {
            const key: ReminderBotKey = `${tpl}.${lang}`;
            const label = `${t.rem.templates[tpl]} · ${r.langs[lang]}`;
            return (
              <Field key={key} label={label} hint={`${s.templates[tpl]} (${lang})`} name={key}>
                <input
                  className="input input-amount mono"
                  inputMode="numeric"
                  value={typed[key] ?? (s.bots[key] == null ? '' : String(s.bots[key]))}
                  aria-label={label}
                  onChange={(e) => setTyped((x) => ({ ...x, [key]: e.target.value }))}
                  onBlur={() => void save(key)}
                />
              </Field>
            );
          }),
        )}
      </section>

      <section className="card">
        <BlockHead title={r.testLeads} />
        <Field label={r.testLeads} hint={r.testHint} name="testLeads">
          <input
            className="input mono"
            value={typed.testLeads ?? leadsText}
            aria-label={r.testLeads}
            onChange={(e) => setTyped((x) => ({ ...x, testLeads: e.target.value }))}
            onBlur={() => void save('testLeads')}
          />
        </Field>
        {s.updatedBy && <p className="hint muted">{r.by(s.updatedBy, fmtDateAt(s.updatedAt))}</p>}
      </section>
      {op.failure && (
        <p className="field-err" role="alert">
          {op.failure.fieldText ?? op.failure.text}
        </p>
      )}
    </>
  );
}
