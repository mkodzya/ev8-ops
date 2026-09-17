import { PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { PointsBlock } from './SettingsPage.js';

/** Fleet → Points, the owner's tab (wave 1 §3.2): the same list Settings keeps. */
export function PointsPage() {
  const t = useT();
  return (
    <>
      <PageHead title={t.nav.fleet} />
      <PointsBlock />
    </>
  );
}
