import { Routes, Route, Navigate } from 'react-router-dom';
import PharmacistDashboard from './PharmacistDashboard';
import PharmacyInventoryPage from './PharmacyInventoryPage';
import PharmacyReportsPage from './PharmacyReportsPage';
import ProfilePage from '../profile/ProfilePage';

const PharmacistRouter = () => (
  <Routes>
    <Route index element={<PharmacistDashboard />} />
    <Route path="orders" element={<PharmacistDashboard />} />
    <Route path="inventory" element={<PharmacyInventoryPage />} />
    <Route path="reports" element={<PharmacyReportsPage />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="*" element={<Navigate to="/pharmacist" replace />} />
  </Routes>
);

export default PharmacistRouter;
