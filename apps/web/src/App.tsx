import { REDIRECTS, type Permission } from '@ev8/shared';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { LoginPage } from './LoginPage.js';
import { AppShell } from './ds/shell/AppShell.js';
import { NoAccess } from './ds/state/NoAccess.js';
import { BatteriesPage } from './pages/BatteriesPage.js';
import { PointsPage } from './pages/PointsPage.js';
import { ReturnPickPage } from './pages/ReturnPickPage.js';
import { DesignPage } from './pages/DesignPage.js';
import { DesignCatalog } from './pages/DesignCatalog.js';
import { EconomicsPage } from './pages/EconomicsPage.js';
import { WeekPage } from './pages/WeekPage.js';
import { UtilisationPage } from './pages/UtilisationPage.js';
import { PartPage } from './pages/PartPage.js';
import { StockPage } from './pages/StockPage.js';
import { CustomerForm } from './pages/CustomerForm.js';
import { CustomerPage } from './pages/CustomerPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { DepositsPage } from './pages/money/DepositsPage.js';
import { MoneyHome } from './pages/money/MoneyHome.js';
import { PaymentPage } from './pages/money/PaymentPage.js';
import { PaymentsList } from './pages/money/PaymentsList.js';
import { RulesPage, SortPage } from './pages/money/SortPage.js';
import { TillPage } from './pages/money/TillPage.js';
import { PickupWizard } from './pages/PickupWizard.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { LoginSettingsPage, RentalSettingsPage, SettingsPage } from './pages/SettingsPage.js';
import { JournalPage } from './pages/JournalPage.js';
import { MigrationPage } from './pages/MigrationPage.js';
import { KommoPage } from './pages/KommoPage.js';
import { RentalPage } from './pages/RentalPage.js';
import { ReturnWizard } from './pages/ReturnWizard.js';
import { PurchasePage } from './pages/PurchasePage.js';
import { PurchasesPage } from './pages/PurchasesPage.js';
import { SupplierPage } from './pages/SupplierPage.js';
import { SuppliersPage } from './pages/SuppliersPage.js';
import { SalePage } from './pages/SalePage.js';
import { SalesPage } from './pages/SalesPage.js';
import { SaleWizard } from './pages/SaleWizard.js';
import { ServiceJobPage } from './pages/ServiceJobPage.js';
import { ServicePage } from './pages/ServicePage.js';
import { StatementsPage } from './pages/money/StatementsPage.js';
import { VehiclePage } from './pages/VehiclePage.js';
import { ModelPage } from './pages/ModelPage.js';
import { ModelsPage } from './pages/ModelsPage.js';
import { FleetPage } from './pages/FleetPage.js';
import { RentalsPage } from './pages/RentalsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { useT } from './i18n/index.js';
import { useSession } from './session.js';

/** To the login page, remembering this screen so signing in comes back to it (B1-02). */
function ToLogin() {
  const { pathname, search } = useLocation();
  return <Navigate to="/login" replace state={{ from: pathname + search }} />;
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { me, loading, unreachable } = useSession();
  if (loading) return null;
  if (!me && unreachable) return <Unreachable />;
  if (!me) return <ToLogin />;
  return children;
}

/**
 * A section the role does not have (wave 1 §3.8, "Нет прав"): it is not in any
 * menu, and a direct link says so instead of landing somewhere else. The API
 * closes the same door for real.
 */
function Require({ perm, children }: { perm: Permission; children: React.ReactElement }) {
  const { me, loading, can, unreachable } = useSession();
  if (loading) return null;
  if (!me && unreachable) return <Unreachable />;
  if (!me) return <ToLogin />;
  if (!can(perm)) return <NoAccess />;
  return children;
}

/** Opened with the server out of reach: wait for it, do not ask for a password nobody can check. */
function Unreachable() {
  const t = useT();
  const { refresh } = useSession();
  return (
    <div className="login-wrap">
      <div className="login-card" role="status">
        <p className="t-h3">{t.session.unreachable}</p>
        <p className="login-note">{t.session.unreachableNote}</p>
        <button type="button" className="pill pill-accent pill-wide" onClick={() => void refresh()}>
          {t.errors.retry}
        </button>
      </div>
    </div>
  );
}

/** An old address, with its :id carried over (build plan Р8). */
function Moved({ to }: { to: string }) {
  const params = useParams();
  const { search } = useLocation();
  const target = to.replace(/:(\w+)/g, (_, k: string) => params[k] ?? '');
  return <Navigate to={target + search} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* Outside the frame: /design shows it inside two iframes of its own width. */}
      <Route path="/design/catalog" element={<Require perm="users.manage"><DesignCatalog /></Require>} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<TodayPage />} />

        <Route path="rentals" element={<RentalsPage />} />
        <Route path="rentals/new" element={<PickupWizard />} />
        <Route path="rentals/return" element={<Require perm="rental.return"><ReturnPickPage /></Require>} />
        <Route path="rentals/:id" element={<RentalPage />} />
        <Route path="rentals/:id/return" element={<ReturnWizard />} />

        <Route path="fleet" element={<FleetPage />} />
        <Route path="fleet/models" element={<ModelsPage />} />
        <Route path="fleet/models/:id" element={<ModelPage />} />
        <Route path="fleet/batteries" element={<BatteriesPage />} />
        <Route path="fleet/points" element={<Require perm="settings.manage"><PointsPage /></Require>} />
        <Route path="settings/points" element={<Require perm="settings.manage"><PointsPage /></Require>} />
        <Route path="fleet/:id" element={<VehiclePage />} />

        <Route path="service" element={<ServicePage />} />
        <Route path="service/stock" element={<StockPage />} />
        <Route path="service/stock/parts/:id" element={<PartPage />} />
        <Route path="service/:id" element={<ServiceJobPage />} />

        {/* Money in one place (wave 2 §3.0). */}
        <Route path="money" element={<Require perm="payments.view"><MoneyHome /></Require>} />
        <Route path="money/sort" element={<Require perm="payments.reconcile"><SortPage /></Require>} />
        <Route path="money/sort/rules" element={<Require perm="payments.reconcile"><RulesPage /></Require>} />
        <Route path="money/payments" element={<Require perm="payments.view"><PaymentsList /></Require>} />
        <Route path="money/payments/:id" element={<Require perm="cash.record"><PaymentPage /></Require>} />
        <Route path="money/mine" element={<Require perm="cash.record"><PaymentsList mine /></Require>} />
        <Route path="money/cash" element={<Require perm="cash.record"><TillPage /></Require>} />
        <Route path="money/statements" element={<Require perm="payments.reconcile"><StatementsPage /></Require>} />
        <Route path="money/deposits" element={<Require perm="payments.view"><DepositsPage /></Require>} />

        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/new" element={<Require perm="sales.manage"><SaleWizard /></Require>} />
        <Route path="sales/:id" element={<SalePage />} />
        <Route path="purchases" element={<Require perm="purchases.view"><PurchasesPage /></Require>} />
        <Route path="purchases/suppliers" element={<Require perm="purchases.view"><SuppliersPage /></Require>} />
        <Route path="purchases/suppliers/:id" element={<Require perm="purchases.view"><SupplierPage /></Require>} />
        <Route path="purchases/:id" element={<Require perm="purchases.view"><PurchasePage /></Require>} />

        {/* Reports open on the week: it is what the Monday meeting reads (wave 6 §3.1). */}
        <Route path="reports" element={<Navigate to="/reports/week" replace />} />
        <Route path="reports/week" element={<Require perm="reports.view"><WeekPage /></Require>} />
        <Route path="reports/utilisation" element={<Require perm="reports.view"><UtilisationPage /></Require>} />
        <Route path="reports/economics" element={<Require perm="reports.view"><EconomicsPage /></Require>} />

        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerForm />} />
        <Route path="customers/:id" element={<CustomerPage />} />
        <Route path="me" element={<ProfilePage />} />
        {/* Settings is six tabs since wave 6 (§3.4–3.9); the people are first. */}
        <Route path="settings" element={<Require perm="users.manage"><SettingsPage /></Require>} />
        <Route path="settings/rental" element={<Require perm="settings.manage"><RentalSettingsPage /></Require>} />
        <Route path="settings/journal" element={<Require perm="users.manage"><JournalPage /></Require>} />
        <Route path="settings/migration" element={<Require perm="users.manage"><MigrationPage /></Require>} />
        <Route path="settings/login" element={<Require perm="users.manage"><LoginSettingsPage /></Require>} />
        {/* Kommo against the rentals here (ADR-0012): opened from its row in
            "Today", in no menu — with the link off there is nothing on it. */}
        <Route path="settings/kommo" element={<Require perm="users.manage"><KommoPage /></Require>} />
        {/* The design catalogue is a review surface, not an operating screen:
            the owner reads it by address, it is in no menu. */}
        <Route path="design" element={<Require perm="users.manage"><DesignPage /></Require>} />

        {REDIRECTS.map((r) => (
          <Route key={r.from} path={r.from.slice(1)} element={<Moved to={r.to} />} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
