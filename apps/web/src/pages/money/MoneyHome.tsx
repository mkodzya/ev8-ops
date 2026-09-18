import { Navigate } from 'react-router-dom';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { useLoad } from '../../lib/use.js';

/**
 * /money opens on "Разобрать" while there is something to sort — that is the
 * work — and on the payments once there is not (wave 2 §3.0).
 */
export function MoneyHome() {
  const { data, failure } = useLoad<{ queue: number }>('/api/statements');
  if (failure) return <Navigate to="/money/payments" replace />;
  if (!data) return <Skeleton rows={3} />;
  return <Navigate to={data.queue > 0 ? '/money/sort' : '/money/payments'} replace />;
}
