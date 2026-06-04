import { Routes, Route, Navigate } from 'react-router-dom';
import LabDashboard from './LabDashboard';
import LabOrdersPage from './LabOrdersPage';
import LabReportsPage from './LabReportsPage';
import LabMonthlyReportPage from './LabMonthlyReportPage';
import ProfilePage from '../profile/ProfilePage';

const LabRouter = () => (
  <Routes>
    <Route index element={<LabDashboard />} />
    <Route path="orders" element={<LabOrdersPage />} />
    <Route path="reports" element={<LabReportsPage />} />
    <Route path="monthly-report" element={<LabMonthlyReportPage />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="*" element={<Navigate to="/lab" replace />} />
  </Routes>
);

export default LabRouter;
