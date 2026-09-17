import { REDIRECTS, type Permission } from '@ev8/shared';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { LoginPage } from './LoginPage.js';
import { AppShell } from './ds/shell/AppShell.js';
import { NoAccess } from './ds/state/NoAccess.js';
import { PointsPage } from './pages/PointsPage.js';
import { ReturnPickPage } from './pages/ReturnPickPage.js';
import { DesignPage } from './pages/DesignPage.js';
import { EconomicsPage } from './pages/EconomicsPage.js';
import { PartPage } from './pages/PartPage.js';
import { StockPage } from './pages/StockPage.js';
import { CustomerForm } from './pages/CustomerForm.js';
import { CustomerPage } from './pages/CustomerPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { PaymentsPage } from './pages/PaymentsPage.js';
import { PickupWizard } from './pages/PickupWizard.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { RentalPage } from './pages/RentalPage.js';
import { ReturnWizard } from './pages/ReturnWizard.js';
import { PurchasePage } from './pages/PurchasePage.js';
import { PurchasesPage } from './pages/PurchasesPage.js';
import { SalePage } from './pages/SalePage.js';
import { SalesPage } from './pages/SalesPage.js';
import { ServiceJobPage } from './pages/ServiceJobPage.js';
import { ServicePage } from './pages/ServicePage.js';
import { StatementsPage } from './pages/StatementsPage.js';
import { VehiclePage } from './pages/VehiclePage.js';
import { ModelPage } from './pages/ModelPage.js';
import { ModelsPage } from './pages/ModelsPage.js';
import { FleetPage } from './pages/FleetPage.js';
import { RentalsPage } from './pages/RentalsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { useSession } from './session.js';

/** To the login page, remembering this screen so signing in comes back to it (B1-02). */
function ToLogin() {
  const { pathname, search } = useLocation();
  return <Navigate to="/login" replace state={{ from: pathname + search }} />;
}

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { me, loading } = useSession();
  if (loading) return null;
  if (!me) return <ToLogin />;
  return children;
}

/**
 * A section the role does not have (wave 1 §3.8, "Нет прав"): it is not in any
 * menu, and a direct link says so instead of landing somewhere else. The API
 * closes the same door for real.
 */
function Require({ perm, children }: { perm: Permission; children: React.ReactElement }) {
  const { me, loading, can } = useSession();
  if (loading) return null;
  if (!me) return <ToLogin />;
  if (!can(perm)) return <NoAccess />;
  return children;
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
        <Route path="fleet/points" element={<Require perm="settings.manage"><PointsPage /></Require>} />
        <Route path="fleet/:id" element={<VehiclePage />} />

        <Route path="service" element={<ServicePage />} />
        <Route path="service/stock" element={<StockPage />} />
        <Route path="service/stock/parts/:id" element={<PartPage />} />
        <Route path="service/:id" element={<ServiceJobPage />} />

        <Route path="money" element={<Navigate to="/money/payments" replace />} />
        <Route path="money/payments" element={<Require perm="payments.view"><PaymentsPage /></Require>} />
        <Route path="money/cash" element={<Require perm="cash.record"><PaymentsPage till /></Require>} />
        <Route path="money/statements" element={<Require perm="payments.reconcile"><StatementsPage /></Require>} />

        <Route path="sales" element={<SalesPage />} />
        <Route path="sales/:id" element={<SalePage />} />
        <Route path="purchases" element={<Require perm="purchases.view"><PurchasesPage /></Require>} />
        <Route path="purchases/:id" element={<Require perm="purchases.view"><PurchasePage /></Require>} />

        <Route path="reports" element={<Navigate to="/reports/economics" replace />} />
        <Route path="reports/economics" element={<Require perm="reports.view"><EconomicsPage /></Require>} />

        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerForm />} />
        <Route path="customers/:id" element={<CustomerPage />} />
        <Route path="me" element={<ProfilePage />} />
        <Route path="settings" element={<Require perm="users.manage"><SettingsPage /></Require>} />
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
