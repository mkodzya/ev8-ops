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
  /** Step 2 (ADR-0013): the payment notes this stand writes into deals. */
  notes?: {
    mode: 'off' | 'all' | 'only';
    sent: number;
    waiting: number;
    stuck: { id: string; paymentId: string; rentalId: string | null; rentalNumber: string | null; customer: string | null; why: 'refused' | 'no_deal'; httpStatus: number | null }[];
  } | null;
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
                      <span className="q-sub muted">{[x.contactName && x.contactName !== x.leadName ? k.contact(x.contactName) : '', x.customer ? k.card(x.customer.name) : k.noCard].filter(Boolean).join(' · ')}</span>
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

      {d.notes && <Notes notes={d.notes} />}
    </>
  );
}

/**
 * What goes the other way: a rental payment taken here, written into the
 * deal as a note. The first line says whether this stand writes at all — a
 * stand that is being tried out does not, and somebody who took a trial
 * payment should not go looking for it in Kommo.
 */
function Notes({ notes }: { notes: NonNullable<Reconciliation['notes']> }) {
  const t = useT();
  const k = t.kommoLink;
  return (
    <section className="card queue-card">
      <BlockHead title={k.notesTitle} note={notes.mode === 'off' ? k.notesOff : notes.mode === 'only' ? k.notesOnly : k.notesAll} />
      {notes.mode !== 'off' && <p className="muted">{k.notesCounts(notes.sent, notes.waiting)}</p>}
      {notes.stuck.length > 0 && (
        <>
          <p className="warn-text">{k.notesStuck}</p>
          <ul className="queue">
            {notes.stuck.map((x) => (
              <li key={x.id} className="q-row">
                <Link to={x.rentalId ? `/rentals/${x.rentalId}` : `/money/payments/${x.paymentId}`} className="q-who">
                  <span className="q-name">{x.customer ?? x.rentalNumber ?? ''}</span>
                  <span className="q-sub muted">{[x.rentalNumber ?? '', x.why === 'no_deal' ? k.notesNoDeal : k.notesRefused(x.httpStatus ? ` (${x.httpStatus})` : '')].filter(Boolean).join(' · ')}</span>
                </Link>
                <span className="q-acts">
                  <Link className="pill pill-sm" to={`/money/payments/${x.paymentId}`}>
                    {k.notesOpenPayment}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
