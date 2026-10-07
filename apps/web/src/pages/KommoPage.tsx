import { localDateTime, type KommoFreshness } from '@ev8/shared';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

// Kommo against the rentals here (ADR-0012): the list behind the row in
// "Today". Kommo is where the day is written down, so its "rented" stage is
// read every few minutes and laid beside what runs here; this screen shows
// where the two disagree and how old Kommo's answer is.
//
// It is in no menu: with the link off there is nothing to show, and an owner
// who has never heard of it should not find an empty tab.

interface Reconciliation {
  on: boolean;
  freshness: KommoFreshness;
  lastOkAt: string | null;
  leads: number;
  matched: number;
  rentedThere: { leadId: string; leadName: string; contactName: string | null; customer: { id: string; name: string } | null; leadUrl: string }[];
  rentedHere: { rentalId: string; number: string; vin: string | null; customer: { id: string; name: string }; leadId: string | null; reason: 'not_rented' | 'no_link'; leadUrl: string | null }[];
}

export function KommoPage() {
  const t = useT();
  const k = t.kommoLink;
  const r = useLoad<Reconciliation>('/api/kommo/reconciliation');

  if (!r.data) {
    return (
      <>
        <PageHead title={k.title} sub={k.subtitle} />
        {r.failure ? <LoadError failure={r.failure} onRetry={r.reload} /> : <Loading />}
      </>
    );
  }
  const d = r.data;
  if (!d.on) {
    return (
      <>
        <PageHead title={k.title} sub={k.subtitle} />
        <section className="card">
          <Empty text={k.off} />
        </section>
      </>
    );
  }

  const at = d.lastOkAt ? localDateTime(d.lastOkAt) : null;
  const silent = d.freshness === 'silent';

  return (
    <>
      <PageHead title={k.title} sub={k.subtitle} />

      {/* How old the answer is comes before the answer: a list that is a day
          old is read differently from one that is five minutes old. */}
      <section className="card">
        {!at ? (
          <p className={silent ? 'warn-text' : 'muted'}>{silent ? k.silentNever : k.waiting}</p>
        ) : (
          <>
            <p className={silent ? 'warn-text' : 'muted'}>{silent ? k.silentSince(at.date, at.time) : k.freshAt(at.date, at.time)}</p>
            <p>{k.summary(d.leads, d.matched)}</p>
          </>
        )}
      </section>

      {at && (
        <>
          <section className="card queue-card">
            <BlockHead title={`${k.rentedThere} — ${d.rentedThere.length}`} note={d.rentedThere.length > 0 ? k.rentedThereNote : undefined} />
            {d.rentedThere.length === 0 ? (
              <Empty text={k.nothing} />
            ) : (
              <ul className="queue">
                {d.rentedThere.map((x) => {
                  const words = (
                    <>
                      <span className="q-name">{x.leadName || k.unnamed}</span>
                      <span className="q-sub muted">{[x.contactName && x.contactName !== x.leadName ? k.contact(x.contactName) : '', x.customer ? x.customer.name : k.noCard].filter(Boolean).join(' · ')}</span>
                    </>
                  );
                  return (
                    <li key={x.leadId} className="q-row">
                      {/* The row opens the card the rental is to be entered on; with no card here it opens nothing. */}
                      {x.customer ? (
                        <Link to={`/customers/${x.customer.id}`} className="q-who">
                          {words}
                        </Link>
                      ) : (
                        <span className="q-who">{words}</span>
                      )}
                      <span className="q-acts">
                        <a className="pill pill-sm" href={x.leadUrl} target="_blank" rel="noreferrer">
                          {t.kommo.open}
                        </a>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card queue-card">
            <BlockHead title={`${k.rentedHere} — ${d.rentedHere.length}`} note={d.rentedHere.length > 0 ? k.rentedHereNote : undefined} />
            {d.rentedHere.length === 0 ? (
              <Empty text={k.nothing} />
            ) : (
              <ul className="queue">
                {d.rentedHere.map((x) => (
                  <li key={x.rentalId} className="q-row">
                    <Link to={`/rentals/${x.rentalId}`} className="q-who">
                      <span className="q-name">{x.customer.name}</span>
                      <span className="q-sub muted">{[x.number, x.vin ? `···${x.vin.slice(-4)}` : '', x.reason === 'no_link' ? k.noLink : k.notRented].filter(Boolean).join(' · ')}</span>
                    </Link>
                    {x.leadUrl && (
                      <span className="q-acts">
                        <a className="pill pill-sm" href={x.leadUrl} target="_blank" rel="noreferrer">
                          {t.kommo.open}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
