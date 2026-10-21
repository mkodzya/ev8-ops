import { useLocale, useT } from '../i18n/index.js';
import { spanText, type Downtime } from '../lib/maintenance.js';

/** «26 ч · из них ожидание согласования 25 мин», «простой сейчас 3 ч», or «нет данных». */
export function DowntimeText({ d }: { d: Downtime | null }) {
  const t = useT();
  const { locale } = useLocale();
  if (!d) return <span className="muted">{t.wmaint.noData}</span>;
  const span = spanText(d.minutes, t, locale);
  return (
    <span>
      <span className="mono">{d.running ? t.wmaint.sofar(span) : span}</span>
      {d.waitMinutes > 0 && <span className="muted"> · {t.wmaint.waited(spanText(d.waitMinutes, t, locale))}</span>}
    </span>
  );
}
