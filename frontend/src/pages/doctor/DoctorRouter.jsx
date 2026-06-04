import { Routes, Route, Navigate } from 'react-router-dom';
import DoctorDashboard from './DoctorDashboard';
import ConsultationRoom from './ConsultationRoom';
import OfflineConsultationRoom from './OfflineConsultationRoom';
import ConsultationsPage from './ConsultationsPage';
import DoctorPatientsPage from './DoctorPatientsPage';
import PrescriptionsPage from './PrescriptionsPage';
import LabOrdersPage from './LabOrdersPage';
import ManageSlots from './ManageSlots';
import PatientEHR from './PatientEHR';
import PlaceholderPage from '../PlaceholderPage';

const DoctorRouter = () => (
  <Routes>
    <Route index element={<DoctorDashboard />} />
    <Route path="consultation/:consultation_id" element={<ConsultationRoom />} />
    <Route path="offline-consultation/:consultation_id" element={<OfflineConsultationRoom />} />
    <Route path="consultations" element={<ConsultationsPage />} />
    <Route path="slots" element={<ManageSlots />} />
    <Route path="patient-ehr/:patient_id" element={<PatientEHR />} />
    <Route path="patients" element={<DoctorPatientsPage />} />
    <Route path="prescriptions" element={<PrescriptionsPage />} />
    <Route path="lab-orders" element={<LabOrdersPage />} />
    <Route path="notifications" element={<PlaceholderPage title="Notifications" />} />
    <Route path="profile" element={<PlaceholderPage title="My Profile" />} />
    <Route path="*" element={<Navigate to="/doctor" replace />} />
  </Routes>
);

export default DoctorRouter;
