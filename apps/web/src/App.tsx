import { REDIRECTS, homePathFor, movedTo, type Permission } from '@ev8/shared';
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
import { CalendarPage } from './pages/money/CalendarPage.js';
import { ScheduleDuePage, ScheduleLatePage, ScheduleMonthPage } from './pages/money/SchedulePages.js';
import { DepositsPage } from './pages/money/DepositsPage.js';
import { PaymentPage } from './pages/money/PaymentPage.js';
import { PaymentsList } from './pages/money/PaymentsList.js';
import { AsidePage, RulesPage, SortPage } from './pages/money/SortPage.js';
import { TillPage } from './pages/money/TillPage.js';
import { PickupWizard } from './pages/PickupWizard.js';
import { MopedByNumber } from './pages/MopedByNumber.js';
import { ExpenseCategoriesPage, IncomeCategoriesPage } from './pages/ExpenseCategoriesPage.js';
import { ExpensesReportPage } from './pages/ExpensesReportPage.js';
import { IncomingReportPage } from './pages/IncomingReportPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { LoginSettingsPage, RentalSettingsPage, SettingsPage } from './pages/SettingsPage.js';
import { RepairSettingsPage } from './pages/RepairSettingsPage.js';
import { JournalPage } from './pages/JournalPage.js';
import { MigrationPage } from './pages/MigrationPage.js';
import { KommoPage } from './pages/KommoPage.js';
import { DrivePage } from './pages/DrivePage.js';
import { RentalPage } from './pages/RentalPage.js';
import { ReturnWizard } from './pages/ReturnWizard.js';
import { SwapWizard } from './pages/SwapWizard.js';
import { PurchasePage } from './pages/PurchasePage.js';
import { PurchasesPage } from './pages/PurchasesPage.js';
import { SupplierPage } from './pages/SupplierPage.js';
import { SuppliersPage } from './pages/SuppliersPage.js';
import { SalePage } from './pages/SalePage.js';
import { SalesPage } from './pages/SalesPage.js';
import { GoodsSalesPage } from './pages/goods/GoodsSalesPage.js';
import { GoodsSaleWizard } from './pages/goods/GoodsSaleWizard.js';
import { GoodsSalePage } from './pages/goods/GoodsSalePage.js';
import { SaleWizard } from './pages/SaleWizard.js';
import { ServiceJobPage } from './pages/ServiceJobPage.js';
import { ServicePage } from './pages/ServicePage.js';
import { WorkBookPage } from './pages/WorkBookPage.js';
import { PayoutsPage } from './pages/PayoutsPage.js';
import { MechanicBalancePage } from './pages/MechanicBalancePage.js';
import { WorkshopJobWizard } from './pages/WorkshopJobWizard.js';
import { RepairClosePage } from './pages/RepairClosePage.js';
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

/**
 * "/" is "Today" — the front office's queue. Whoever has none of it, a
 * mechanic, lands on their own first section instead (ADR-0033).
 */
function Home() {
  const { me, can } = useSession();
  if (!me || can('fleet.view')) return <TodayPage />;
  return <Navigate to={homePathFor(me.permissions)} replace />;
}

/** An old address, with its :id and its query carried over (build plan Р8; issue #15). */
function Moved({ from }: { from: string }) {
  const params = useParams();
  const { search } = useLocation();
  const target = movedTo(from, search);
  const q = target.indexOf('?');
  const path = (q < 0 ? target : target.slice(0, q)).replace(/:(\w+)/g, (_, k: string) => params[k] ?? '');
  return <Navigate to={path + (q < 0 ? '' : target.slice(q))} replace />;
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
        <Route index element={<Home />} />

        <Route path="rentals" element={<RentalsPage />} />
        <Route path="rentals/new" element={<PickupWizard />} />
        <Route path="rentals/return" element={<Require perm="rental.return"><ReturnPickPage /></Require>} />
        <Route path="rentals/:id" element={<RentalPage />} />
        <Route path="rentals/:id/return" element={<ReturnWizard />} />
        <Route path="rentals/:id/swap" element={<Require perm="rental.return"><SwapWizard /></Require>} />

        <Route path="fleet" element={<FleetPage />} />
        <Route path="fleet/models" element={<ModelsPage />} />
        <Route path="fleet/models/:id" element={<ModelPage />} />
        <Route path="fleet/points" element={<Require perm="settings.manage"><PointsPage /></Require>} />
        <Route path="settings/points" element={<Require perm="settings.manage"><PointsPage /></Require>} />
        <Route path="fleet/:id" element={<VehiclePage />} />
        {/* A sticker's QR: ops.ev8.ge/m/EV-007 (Mika, 15.10.2026). */}
        <Route path="m/:code" element={<MopedByNumber />} />

        <Route path="service" element={<ServicePage />} />
        <Route path="service/new" element={<Require perm="service.work"><WorkshopJobWizard /></Require>} />
        <Route path="service/:id/close" element={<Require perm="service.work"><RepairClosePage /></Require>} />
        <Route path="service/works" element={<Require perm="service.norms"><WorkBookPage /></Require>} />
        {/* Paying the mechanic (stage 5, ADR-0037): the owners mark it, a mechanic reads his own. */}
        <Route path="service/payouts" element={<Require perm="service.payout"><PayoutsPage /></Require>} />
        <Route path="service/balance" element={<Require perm="service.work"><MechanicBalancePage /></Require>} />
        <Route path="service/:id" element={<ServiceJobPage />} />

        {/* «Оплаты по графику» (issue #15, ADR-0048; was «Деньги → Календарь»): a manager's
            too — the rows; the month's figures are an owner's. */}
        <Route path="schedule" element={<Require perm="payments.schedule"><ScheduleDuePage /></Require>} />
        <Route path="schedule/late" element={<Require perm="payments.schedule"><ScheduleLatePage /></Require>} />
        <Route path="schedule/calendar" element={<Require perm="payments.schedule"><CalendarPage /></Require>} />
        <Route path="schedule/month" element={<Require perm="payments.view"><ScheduleMonthPage /></Require>} />
        {/* «Разобрать» (issue #15; was a tab of Money): a manager sorts the money coming in. */}
        <Route path="sort" element={<Require perm="payments.sort.customer"><SortPage direction="in" /></Require>} />
        <Route path="sort/out" element={<Require perm="payments.reconcile"><SortPage direction="out" /></Require>} />
        <Route path="sort/rules" element={<Require perm="payments.reconcile"><RulesPage /></Require>} />
        <Route path="sort/aside" element={<Require perm="payments.reconcile"><AsidePage /></Require>} />

        {/* What is left of Money (wave 2 §3.0): the payments, the statements, the deposits. */}
        <Route path="money/payments" element={<Require perm="payments.view"><PaymentsList /></Require>} />
        <Route path="money/payments/:id" element={<Require perm="cash.record"><PaymentPage /></Require>} />
        <Route path="money/mine" element={<Require perm="cash.record"><PaymentsList mine /></Require>} />
        <Route path="money/cash" element={<Require perm="cash.record"><TillPage /></Require>} />
        <Route path="money/statements" element={<Require perm="payments.reconcile"><StatementsPage /></Require>} />
        <Route path="money/deposits" element={<Require perm="payments.view"><DepositsPage /></Require>} />

        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/new" element={<Require perm="sales.manage"><SaleWizard /></Require>} />
        {/* Goods sold over the counter (issue #11, ADR-0045): a static segment, so it wins over sales/:id. */}
        <Route path="sales/goods" element={<GoodsSalesPage />} />
        <Route path="sales/goods/new" element={<Require perm="goods.sell"><GoodsSaleWizard /></Require>} />
        <Route path="sales/goods/:id" element={<GoodsSalePage />} />
        <Route path="sales/:id" element={<SalePage />} />
        {/* «Склад» (issue #19): the parts, and the batteries and chargers — were tabs of the repairs and the mopeds. */}
        <Route path="stock" element={<StockPage />} />
        <Route path="stock/batteries" element={<BatteriesPage />} />
        <Route path="stock/parts/:id" element={<PartPage />} />
        <Route path="purchases" element={<Require perm="purchases.view"><PurchasesPage /></Require>} />
        <Route path="purchases/suppliers" element={<Require perm="purchases.view"><SuppliersPage /></Require>} />
        <Route path="purchases/suppliers/:id" element={<Require perm="purchases.view"><SupplierPage /></Require>} />
        <Route path="purchases/:id" element={<Require perm="purchases.view"><PurchasePage /></Require>} />

        {/* Reports open on the week: it is what the Monday meeting reads (wave 6 §3.1). */}
        <Route path="reports" element={<Navigate to="/reports/week" replace />} />
        <Route path="reports/week" element={<Require perm="reports.view"><WeekPage /></Require>} />
        <Route path="reports/utilisation" element={<Require perm="reports.view"><UtilisationPage /></Require>} />
        <Route path="reports/economics" element={<Require perm="reports.view"><EconomicsPage /></Require>} />
        <Route path="reports/expenses" element={<Require perm="reports.view"><ExpensesReportPage /></Require>} />
        <Route path="reports/incoming" element={<Require perm="reports.view"><IncomingReportPage /></Require>} />

        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerForm />} />
        <Route path="customers/:id" element={<CustomerPage />} />
        <Route path="me" element={<ProfilePage />} />
        {/* Settings is six tabs since wave 6 (§3.4–3.9); the people are first. */}
        <Route path="settings" element={<Require perm="users.manage"><SettingsPage /></Require>} />
        <Route path="settings/rental" element={<Require perm="settings.manage"><RentalSettingsPage /></Require>} />
        <Route path="settings/repair" element={<Require perm="settings.manage"><RepairSettingsPage /></Require>} />
        <Route path="settings/expenses" element={<Require perm="settings.manage"><ExpenseCategoriesPage /></Require>} />
        <Route path="settings/incoming" element={<Require perm="settings.manage"><IncomeCategoriesPage /></Require>} />
        <Route path="settings/journal" element={<Require perm="users.manage"><JournalPage /></Require>} />
        <Route path="settings/migration" element={<Require perm="users.manage"><MigrationPage /></Require>} />
        <Route path="settings/login" element={<Require perm="users.manage"><LoginSettingsPage /></Require>} />
        {/* Kommo against the rentals here (ADR-0012): opened from its row in
            "Today", in no menu — with the link off there is nothing on it. */}
        <Route path="settings/kommo" element={<Require perm="users.manage"><KommoPage /></Require>} />
        <Route path="settings/drive" element={<Require perm="users.manage"><DrivePage /></Require>} />
        {/* The design catalogue is a review surface, not an operating screen:
            the owner reads it by address, it is in no menu. */}
        <Route path="design" element={<Require perm="users.manage"><DesignPage /></Require>} />

        {REDIRECTS.map((r) => (
          <Route key={r.from} path={r.from.slice(1)} element={<Moved from={r.from} />} />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
