import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage.js';
import { Shell } from './Shell.js';
import { CustomersPage } from './pages/CustomersPage.js';
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
        <Route path="rentals" element={<RentalsPage />} />
        <Route path="customers" element={<CustomersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
