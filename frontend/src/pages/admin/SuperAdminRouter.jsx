import { Routes, Route, Navigate } from 'react-router-dom';
import SuperAdminDashboard from './SuperAdminDashboard';
import UsersPage from './UsersPage';
import FLMonitor from './FLMonitor';
import SettingsPage from './SettingsPage';
import ApprovalsPage from './ApprovalsPage';
import AuditLogsPage from './AuditLogsPage';
import EpidemicPage from './EpidemicPage';
import ResolvedAlertsPage from './ResolvedAlertsPage';
import EpidemicHistoryPage from './EpidemicHistoryPage';
import ComplaintsManagePage from './ComplaintsManagePage';

const SuperAdminRouter = () => (
  <Routes>
    <Route index element={<SuperAdminDashboard />} />
    <Route path="approvals" element={<ApprovalsPage />} />
    <Route path="users" element={<UsersPage />} />
    <Route path="fl" element={<FLMonitor />} />
    <Route path="epidemic" element={<EpidemicPage />} />
    <Route path="epidemic/resolved" element={<ResolvedAlertsPage />} />
    <Route path="epidemic/history" element={<EpidemicHistoryPage />} />
    <Route path="complaints" element={<ComplaintsManagePage />} />
    <Route path="audit-logs" element={<AuditLogsPage />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<Navigate to="/admin" replace />} />
  </Routes>
);

export default SuperAdminRouter;
