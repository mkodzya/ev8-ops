import { gelFromTetri, parseGel } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useOperation } from '../ds/form/operation.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { kmText } from '../lib/maintenance.js';

// Settings → Repair (stage 6, ADR-0038): the company's rate for an hour of
// norm, the planned-maintenance interval and when a moped is called for it.
// The owners' alone; each field saves on its own when it is left, the way
// the deposit does on Settings → Rental, and the journal keeps the change.

interface ServiceSettings {
  defaultRateTetri: number | null;
  maintenanceIntervalKm: number;
  maintenanceWarnKm: number;
}

type Key = 'defaultRateTetri' | 'maintenanceIntervalKm' | 'maintenanceWarnKm';

export function RepairSettingsPage() {
  const t = useT();
  const settings = useLoad<ServiceSettings>('/api/settings/service');
  const toast = useToast();
  const op = useOperation();
  const [typed, setTyped] = useState<Partial<Record<Key, string>>>({});

  if (!settings.data) {
    return settings.failure ? <LoadError failure={settings.failure} onRetry={settings.reload} /> : <Loading />;
  }
  const s = settings.data;
  const shown: Record<Key, string> = {
    defaultRateTetri: typed.defaultRateTetri ?? (s.defaultRateTetri != null ? String(gelFromTetri(s.defaultRateTetri)) : ''),
    maintenanceIntervalKm: typed.maintenanceIntervalKm ?? kmText(s.maintenanceIntervalKm),
    maintenanceWarnKm: typed.maintenanceWarnKm ?? kmText(s.maintenanceWarnKm),
  };

  // The same figure typed again is not a change: no write, no line in the journal.
  const unchanged = (key: Key, text: string): boolean => {
    if (key === 'defaultRateTetri') return parseGel(text) === s.defaultRateTetri;
    return Number(text.replace(/\s/g, '')) === s[key];
  };

  const save = async (key: Key) => {
    const text = typed[key];
    if (text == null) return;
    if (unchanged(key, text)) {
      setTyped((x) => ({ ...x, [key]: undefined }));
      return;
    }
    // Kilometres go as a whole number; the rate as the GEL typed, which the server reads.
    const value = key === 'defaultRateTetri' ? text : Number(text.replace(/\s/g, ''));
    const res = await op.run((k) => api.patch('/api/settings/service', { [key]: value }, { key: k }), `${key}:${text}`);
    if (!res.ok) return;
    setTyped((x) => ({ ...x, [key]: undefined }));
    toast({ text: t.wmaint.saved });
    settings.reload();
  };

  const field = (key: Key, label: string, hint?: string, decimal = false) => (
    <Field label={label} hint={hint} name={key}>
      <input
        className="input input-amount mono"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={shown[key]}
        aria-label={label}
        onChange={(e) => setTyped((x) => ({ ...x, [key]: e.target.value }))}
        onBlur={() => void save(key)}
      />
    </Field>
  );

  return (
    <>
      <PageHead title={t.settings.title} />
      <section className="card">
        <BlockHead title={t.shell.tabs.repair} />
        {field('defaultRateTetri', t.wmaint.rate, t.wmaint.rateHint, true)}
        {field('maintenanceIntervalKm', t.wmaint.interval)}
        {field('maintenanceWarnKm', t.wmaint.warn)}
        {op.failure && <div className="field-err">{op.failure.fieldText ?? op.failure.text}</div>}
      </section>
    </>
  );
}
