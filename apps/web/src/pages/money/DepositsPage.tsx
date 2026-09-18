import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { PageHead } from '../../components/ui.js';
import { DataList } from '../../ds/list/DataList.js';
import { useMoneyForm } from '../../ds/money/MoneyForm.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, formatGel } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

type Segment = 'held' | 'to_hand_back' | 'short' | 'closed';

interface DepositRow {
  rentalId: string;
  number: string;
  rentalStatus: string;
  customer: { id: string; name: string };
  returnedOn: string | null;
  amountTetri: number;
  paidTetri: number;
  withheldTetri: number;
  returnedTetri: number;
  paidOutTetri: number;
  heldTetri: number;
  toHandBackTetri: number;
  shortTetri: number;
  segment: Segment;
}

/**
 * Money → Залоги (wave 2 §3.6): held is what came in less what was kept and
 * handed back (Q16); what the contracts ask for is a quiet line. "To hand
 * back" opens the money form, outgoing.
 */
export function DepositsPage() {
  const t = useT();
  const openMoney = useMoneyForm();
  const [params, setParams] = useSearchParams();
  const { data, failure, reload } = useLoad<{ totals: { heldTetri: number; contractTetri: number; toHandBackTetri: number; rentals: number }; deposits: DepositRow[] }>('/api/deposits');
  const segment = (['held', 'to_hand_back', 'short', 'closed'] as const).find((s) => s === params.get('s')) ?? 'held';
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  const rows = (data?.deposits ?? []).filter((d) => (segment === 'held' ? d.heldTetri > 0 : d.segment === segment));
  const count = (s: Segment) => (data?.deposits ?? []).filter((d) => (s === 'held' ? d.heldTetri > 0 : d.segment === s)).length;
  const handBack = (d: DepositRow) => openMoney({ target: { kind: 'deposit_payout', rentalId: d.rentalId, number: d.number, customer: d.customer.name, customerId: d.customer.id } });

  return (
    <>
      <PageHead title={t.shell.tabs.deposits} />
      {!data && <Skeleton rows={4} />}
      {data && (
        <>
          <dl className="money-totals">
            <div>
              <dt>{t.deposits.onHand}</dt>
              <dd>{formatGel(data.totals.heldTetri)}</dd>
            </div>
            <div>
              <dt>{t.deposits.contract}</dt>
              <dd className="muted">{formatGel(data.totals.contractTetri)}</dd>
            </div>
          </dl>
          <p className="hint muted">{t.deposits.setNote(data.totals.rentals)}</p>
          <div className="list-chips">
            {(['held', 'to_hand_back', 'short', 'closed'] as const).map((s) => (
              <button key={s} type="button" className={`list-chip ${segment === s ? 'on' : ''}`} onClick={() => setParams(s === 'held' ? {} : { s }, { replace: true })}>
                {t.deposits[s]} <span className="n">{count(s)}</span>
              </button>
            ))}
          </div>
          <DataList
            rows={rows}
            rowKey={(d) => d.rentalId}
            fallback={(a, b) => b.number.localeCompare(a.number)}
            href={(d) => `/rentals/${d.rentalId}`}
            empty={{ text: t.deposits.none }}
            card={(d) => ({
              title: d.customer.name,
              sub: (
                <>
                  {d.number} ·{' '}
                  {d.segment === 'to_hand_back'
                    ? `${t.deposits.returnedOn(fmtDate(d.returnedOn))} · ${d.returnedTetri >= d.paidTetri ? t.deposits.decidedAll : t.deposits.decidedPart(formatGel(d.returnedTetri))}`
                    : d.segment === 'short'
                      ? t.deposits.shortOf(formatGel(d.paidTetri, { decimals: false }), formatGel(d.amountTetri, { decimals: false }), formatGel(d.shortTetri, { decimals: false }))
                      : d.returnedOn
                        ? t.deposits.returnedOn(fmtDate(d.returnedOn))
                        : ''}
                </>
              ),
              right: <span className="t-money">{formatGel(d.segment === 'to_hand_back' ? d.toHandBackTetri : d.heldTetri)}</span>,
              rightSub:
                d.segment === 'to_hand_back' ? (
                  <button
                    type="button"
                    className="pill pill-sm pill-accent"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handBack(d);
                    }}
                  >
                    {t.deposits.handBack}
                  </button>
                ) : undefined,
            })}
            columns={[
              { key: 'number', label: t.rentals.number, cell: (d) => <span className="mono">{d.number}</span>, sort: { value: (d) => d.number } },
              { key: 'who', label: t.rentals.customer, cell: (d) => <span>{d.customer.name}</span>, sort: { value: (d) => d.customer.name } },
              { key: 'contract', label: t.deposits.contractCol, num: true, cell: (d) => <span className="mono">{formatGel(d.amountTetri)}</span>, sort: { value: (d) => d.amountTetri } },
              { key: 'received', label: t.deposits.receivedCol, num: true, cell: (d) => <span className="mono">{formatGel(d.paidTetri)}</span>, sort: { value: (d) => d.paidTetri } },
              { key: 'withheld', label: t.deposits.withheldCol, num: true, cell: (d) => <span className="mono">{formatGel(d.withheldTetri)}</span>, sort: { value: (d) => d.withheldTetri } },
              { key: 'paidOut', label: t.deposits.paidOutCol, num: true, cell: (d) => <span className="mono">{formatGel(d.paidOutTetri)}</span>, sort: { value: (d) => d.paidOutTetri } },
              { key: 'held', label: t.deposits.heldCol, num: true, cell: (d) => <span className="mono">{formatGel(d.heldTetri)}</span>, sort: { value: (d) => d.heldTetri, first: 'desc' } },
              {
                key: 'act',
                label: '',
                cell: (d) =>
                  d.segment === 'to_hand_back' ? (
                    <button
                      type="button"
                      className="pill pill-sm pill-accent"
                      onClick={(e) => {
                        e.stopPropagation();
                        handBack(d);
                      }}
                    >
                      {t.deposits.handBack} {formatGel(d.toHandBackTetri, { decimals: false })}
                    </button>
                  ) : null,
              },
            ]}
          />
        </>
      )}
    </>
  );
}
