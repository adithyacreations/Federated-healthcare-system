import { Routes, Route, Navigate } from 'react-router-dom';
import HospitalDashboard from './HospitalDashboard';
import BedsPage from './BedsPage';
import StaffPage from './StaffPage';
import InventoryPage from './InventoryPage';
import DepartmentsPage from './DepartmentsPage';
import EquipmentOrdersPage from './EquipmentOrdersPage';
import HospitalPatientsPage from './HospitalPatientsPage';
import FLClientPage from './FLClientPage';
import ComplaintsPage from './ComplaintsPage';
import HospitalEmergencyPage from './HospitalEmergencyPage';
import DoctorSchedulePage from './DoctorSchedulePage';
import LabSettingsPage from './LabSettingsPage';

const HospitalRouter = () => (
  <Routes>
    <Route index element={<HospitalDashboard />} />
    <Route path="complaints" element={<ComplaintsPage />} />
    <Route path="lab-settings" element={<LabSettingsPage />} />
    <Route path="beds" element={<BedsPage />} />
    <Route path="staff" element={<StaffPage />} />
    <Route path="schedule" element={<DoctorSchedulePage />} />
    <Route path="inventory" element={<InventoryPage />} />
    <Route path="departments" element={<DepartmentsPage />} />
    <Route path="equipment-orders" element={<EquipmentOrdersPage />} />
    <Route path="patients" element={<HospitalPatientsPage />} />
    <Route path="emergency" element={<HospitalEmergencyPage />} />
    <Route path="fl-client" element={<FLClientPage />} />
    <Route path="*" element={<Navigate to="/hospital" replace />} />
  </Routes>
);

export default HospitalRouter;
