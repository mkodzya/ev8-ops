import { INCOME_ROWS, addDays, paymentMatches, paymentsQuery, todayISO } from '@ev8/shared';
import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { PageHead } from '../../components/ui.js';
import { DataList } from '../../ds/list/DataList.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, formatGel } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

type Kind = 'rent' | 'sale' | 'service' | 'on_account' | 'deposit_payout' | 'buyback' | 'supplier' | 'goods';
/** `deposit`: kept from a deposit; `offset`: rent closed by a mechanic's work at his payout (0066). */
type Channel = 'transfer' | 'acquiring' | 'cash' | 'deposit' | 'offset';
/** What the list filters by: the form's channels and «Зачёт работ», which only a payout writes (Mika, 22.10.2026). */
const FILTER_CHANNELS = ['cash', 'acquiring', 'transfer', 'offset'] as const;

export interface PaymentRow {
  id: string;
  occurredOn: string;
  direction: 'in' | 'out';
  kind: Kind;
  channel: Channel;
  grossTetri: number;
  feeTetri: number;
  netTetri: number;
  customer: { id: string; name: string } | null;
  rental: { id: string; number: string } | null;
  sale: { id: string; number: string } | null;
  purchase: { id: string; number: string } | null;
  serviceJob: { id: string; number: string } | null;
  /** A goods sale (ADR-0045); absent while an older API answers. */
  goodsSale?: { id: string; number: string } | null;
  bankText: string | null;
  note: string | null;
  fromStatement: boolean;
  voided: boolean;
  voidKind: string | null;
  createdBy: string | null;
}

interface Answer {
  totals: { inTetri: number; outTetri: number; acquiringFeeTetri: number; rowTetri: number | null };
  /** Set when a figure of the week's report asked for its own rows (QA-W6-01). */
  row: 'rent' | 'sale' | 'deposits' | 'service' | 'goods' | null;
  people: { id: string; name: string }[];
  payments: PaymentRow[];
}

const PERIODS = ['thisWeek', 'lastWeek', 'month', 'all'] as const;
type Period = (typeof PERIODS)[number];

/** Monday of the week `iso` is in: the company's weeks start on Monday in the reports. */
function monday(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((d + 6) % 7));
}

function range(period: Period, today: string): { from?: string; to?: string } {
  switch (period) {
    case 'thisWeek':
      return { from: monday(today), to: today };
    case 'lastWeek':
      return { from: addDays(monday(today), -7), to: addDays(monday(today), -1) };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
    default:
      return {};
  }
}

/** A payment's number and what it was for, in words (§3.3 "основание словами"). */
export function recordOf(p: Pick<PaymentRow, 'rental' | 'sale' | 'purchase' | 'serviceJob' | 'goodsSale'>): string | null {
  return p.rental?.number ?? p.sale?.number ?? p.purchase?.number ?? p.serviceJob?.number ?? p.goodsSale?.number ?? null;
}

/**
 * Money → Payments (wave 2 §3.3): signed, filtered in the address, the total
 * over the filter above the list. `mine` — a manager's "Мои платежи".
 */
export function PaymentsList({ mine = false }: { mine?: boolean }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  // A figure on "Отчёты → Неделя" links here with its own two dates: the list
  // it opens must be the rows that figure was made of, not the week the list
  // happens to default to (wave 6 §3.1, ux №10).
  const exact = params.get('from') && params.get('to') ? { from: params.get('from')!, to: params.get('to')! } : null;
  const period = (PERIODS as readonly string[]).includes(params.get('period') ?? '') ? (params.get('period') as Period) : 'thisWeek';
  const channel = params.get('channel') ?? '';
  const direction = params.get('direction') ?? '';
  const kind = params.get('kind') ?? '';
  // A figure of the week's report links here asking for its own row, and the
  // list has to pass the question on: without it the server answers about
  // whole payments and the total disagrees with the figure (QA-W6-05).
  const row = (INCOME_ROWS as readonly string[]).includes(params.get('row') ?? '') ? params.get('row')! : '';
  const by = params.get('by') ?? '';
  // One list of filters, shared with the test that checks it: a screen that
  // keeps its own copy is how `row` went missing (QA-W6-05).
  const r = exact ?? range(period, today);
  const asked: Record<string, string> = { from: r.from ?? '', to: r.to ?? '', channel, direction, kind, row, by };
  const { data, failure, reload } = useLoad<Answer>(`/api/payments?${paymentsQuery((k) => asked[k] ?? params.get(k))}`);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const sign = (p: PaymentRow) => (p.direction === 'out' ? '−' : '+');
  const amountCell = (p: PaymentRow) => (
    <span className={`t-money ${p.voided ? 'amt-void' : p.direction === 'out' ? 'amt-out' : 'amt-in'}`}>
      {sign(p)}
      {formatGel(p.grossTetri)}
    </span>
  );
  const what = (p: PaymentRow) => [t.money.kinds[p.kind], recordOf(p)].filter(Boolean).join(' · ');
  // Who paid: the customer, or — a goods sale with no card — the retail buyer; the
  // kind's word stood there and read «Товары» over «Товары · TS-…» (QA 23.10.2026).
  const payer = (p: PaymentRow): string | null => p.customer?.name ?? (p.goodsSale ? t.goods.retail : null);
  const how = (p: PaymentRow) =>
    [t.payments.channels[p.channel], p.channel === 'acquiring' && p.direction === 'in' ? t.payList.bank(formatGel(p.netTetri)) : null, p.fromStatement ? t.payList.stated : null]
      .filter(Boolean)
      .join(' · ');

  return (
    <>
      <PageHead title={mine ? t.payList.mine : t.payments.title} />
      <div className="money-filters">
        <select
          className="input"
          value={exact ? '' : period}
          onChange={(e) => {
            // Picking a period by hand drops the exact dates a link carried.
            const next = new URLSearchParams(params);
            next.delete('from');
            next.delete('to');
            if (e.target.value === 'thisWeek') next.delete('period');
            else next.set('period', e.target.value);
            setParams(next, { replace: true });
          }}
          aria-label={t.payList.thisWeek}
        >
          {exact && (
            <option value="">
              {fmtDate(exact.from)} — {fmtDate(exact.to)}
            </option>
          )}
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {t.payList[p]}
            </option>
          ))}
        </select>
        <select className="input" value={channel} onChange={(e) => setParam('channel', e.target.value)} aria-label={t.payList.allChannels}>
          <option value="">{t.payList.allChannels}</option>
          {FILTER_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {t.payments.channels[c]}
            </option>
          ))}
        </select>
        {!mine && (
          <>
            <select className="input" value={direction} onChange={(e) => setParam('direction', e.target.value)} aria-label={t.payList.inOut}>
              <option value="">{t.payList.inOut}</option>
              <option value="in">{t.money.in}</option>
              <option value="out">{t.money.out}</option>
            </select>
            <select className="input" value={kind} onChange={(e) => setParam('kind', e.target.value)} aria-label={t.payList.anyKind}>
              <option value="">{t.payList.anyKind}</option>
              {(Object.keys(t.money.kinds) as Kind[]).map((k) => (
                <option key={k} value={k}>
                  {t.money.kinds[k]}
                </option>
              ))}
            </select>
            {(data?.people.length ?? 0) > 0 && (
              <select className="input" value={by} onChange={(e) => setParam('by', e.target.value)} aria-label={t.payList.anyone}>
                <option value="">{t.payList.anyone}</option>
                {data!.people.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>

      {!data && failure && <LoadError failure={failure} onRetry={reload} />}
      {!data && !failure && <Skeleton rows={5} />}
      {data && (
        <>
          <dl className="money-totals">
            {/* What belongs to the row of the week that linked here — the
                figure this list has to add up to (ux №10). */}
            {data.row && data.totals.rowTetri != null && (
              <div>
                <dt>{t.weekReport.rowTotals[data.row]}</dt>
                <dd className="amt-in">{formatGel(data.totals.rowTetri)}</dd>
              </div>
            )}
            <div>
              <dt>{t.payList.totalIn}</dt>
              <dd className="amt-in">{data.totals.inTetri > 0 ? '+' : ''}{formatGel(data.totals.inTetri)}</dd>
            </div>
            <div>
              <dt>{t.payList.totalOut}</dt>
              <dd>{data.totals.outTetri > 0 ? '−' : ''}{formatGel(data.totals.outTetri)}</dd>
            </div>
            {data.totals.acquiringFeeTetri > 0 && (
              <div>
                <dt>{t.payList.totalFee}</dt>
                <dd>−{formatGel(data.totals.acquiringFeeTetri)}</dd>
              </div>
            )}
          </dl>
          <DataList
            rows={data.payments}
            rowKey={(p) => p.id}
            fallback={(a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.id.localeCompare(b.id)}
            href={(p) => `/money/payments/${p.id}`}
            search={{
              placeholder: t.lists.paymentsSearch,
              match: (p, s) => paymentMatches(s, { grossTetri: p.grossTetri, customer: payer(p), bankText: p.bankText, note: p.note, createdBy: p.createdBy, rentalNumber: recordOf(p) }),
            }}
            empty={{ text: t.payments.none }}
            card={(p) => ({
              title: payer(p) ?? t.money.kinds[p.kind],
              sub: (
                <>
                  {what(p)} · {fmtDate(p.occurredOn)}
                </>
              ),
              right: amountCell(p),
              rightSub: p.voided ? (p.voidKind === 'undo' ? t.paymentPage.undone : t.paymentPage.voided) : how(p),
            })}
            columns={[
              { key: 'date', label: t.payments.date, cell: (p) => <span className="mono">{fmtDate(p.occurredOn)}</span>, sort: { value: (p) => p.occurredOn, first: 'desc' } },
              { key: 'who', label: t.payments.customer, cell: (p) => <span>{payer(p) ?? t.common.dash}</span>, sort: { value: (p) => payer(p) } },
              { key: 'what', label: t.payList.anyKind, cell: (p) => what(p), sort: { value: (p) => p.kind } },
              { key: 'how', label: t.payments.channel, cell: (p) => <span className="muted">{p.voided ? t.paymentPage.voided : how(p)}</span>, sort: { value: (p) => p.channel } },
              { key: 'by', label: t.payList.anyone, cell: (p) => <span>{p.createdBy ?? t.common.dash}</span>, sort: { value: (p) => p.createdBy } },
              { key: 'amount', label: t.payments.amount, num: true, cell: amountCell, sort: { value: (p) => (p.direction === 'out' ? -p.grossTetri : p.grossTetri), first: 'desc' } },
            ]}
          />
        </>
      )}
    </>
  );
}
