import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage.js';
import { Shell } from './Shell.js';
import { CustomerForm } from './pages/CustomerForm.js';
import { CustomerPage } from './pages/CustomerPage.js';
import { CustomersPage } from './pages/CustomersPage.js';
import { PickupWizard } from './pages/PickupWizard.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { RentalPage } from './pages/RentalPage.js';
import { ReturnWizard } from './pages/ReturnWizard.js';
import { VehiclePage } from './pages/VehiclePage.js';
import { FleetPage } from './pages/FleetPage.js';
import { RentalsPage } from './pages/RentalsPage.js';
import { TodayPage } from './pages/TodayPage.js';
import { useSession } from './session.js';

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { me, loading } = useSession();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  return children;
}

// A hidden tab is not a closed door: the URL still exists and somebody will
// arrive from a bookmark. Sent home rather than shown an error; the API
// closes the same door for real.
function RequireOwner({ children }: { children: React.ReactElement }) {
  const { me, loading, can } = useSession();
  if (loading) return null;
  if (!me) return <Navigate to="/login" replace />;
  if (!can('users.manage')) return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<TodayPage />} />
        <Route path="fleet" element={<FleetPage />} />
        <Route path="fleet/:id" element={<VehiclePage />} />
        <Route path="rentals" element={<RentalsPage />} />
        <Route path="rentals/new" element={<PickupWizard />} />
        <Route path="rentals/:id" element={<RentalPage />} />
        <Route path="rentals/:id/return" element={<ReturnWizard />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/new" element={<CustomerForm />} />
        <Route path="customers/:id" element={<CustomerPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<RequireOwner><SettingsPage /></RequireOwner>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
