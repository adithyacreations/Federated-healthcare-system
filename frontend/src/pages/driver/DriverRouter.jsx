import { Routes, Route, Navigate } from 'react-router-dom';
import DriverDashboard from './DriverDashboard';
import ActiveDispatchPage from './ActiveDispatchPage';
import TripHistoryPage from './TripHistoryPage';
import PlaceholderPage from '../PlaceholderPage';

const DriverRouter = () => (
  <Routes>
    <Route index element={<DriverDashboard />} />
    <Route path="active" element={<ActiveDispatchPage />} />
    <Route path="map" element={<ActiveDispatchPage />} />
    <Route path="history" element={<TripHistoryPage />} />
    <Route path="profile" element={<PlaceholderPage title="My Profile" />} />
    <Route path="notifications" element={<PlaceholderPage title="Notifications" />} />
    <Route path="*" element={<Navigate to="/driver" replace />} />
  </Routes>
);

export default DriverRouter;
