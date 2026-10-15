import { Navigate, useParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

/**
 * Where a sticker's QR lands: /m/EV-007 opens that moped's card (Mika,
 * 15.10.2026). Signed out, the login comes first and returns here. The
 * address is the company's own, so the stickers outlive whatever the card
 * becomes — the mechanic's repair, once his bot moves into EV8 Ops.
 */
export function MopedByNumber() {
  const { code = '' } = useParams();
  const t = useT();
  const { data, failure, reload } = useLoad<{ id: string }>(`/api/fleet/by-number/${encodeURIComponent(code)}`);
  if (data) return <Navigate to={`/fleet/${data.id}`} replace />;
  if (failure?.status === 404) {
    return (
      <>
        <PageHead title={code} />
        <Empty text={t.fleet.noSuchNumber(code)} />
      </>
    );
  }
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  return <Loading />;
}
