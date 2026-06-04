import { Routes, Route, Navigate } from 'react-router-dom';
import PatientDashboard from './PatientDashboard';
import ConsultationsPage from './ConsultationsPage';
import PatientConsultationRoom from './PatientConsultationRoom';
import OrderMedicinePage from './OrderMedicinePage';
import MedicineOrdersPage from './MedicineOrdersPage';
import LabTestPage from './LabTestPage';
import TestRecordsPage from './TestRecordsPage';
import ComplaintsPage from './ComplaintsPage';
import EHRWallet from './EHRWallet';
import EmergencyPage from './EmergencyPage';
import EmergencyHistoryPage from './EmergencyHistoryPage';
import EmergencyTracker from './EmergencyTracker';
import SymptomChecker from './SymptomChecker';
import RiskReport from './RiskReport';
import ProfilePage from '../profile/ProfilePage';
import { PatientWSProvider } from '../../context/PatientWebSocketContext';

const PatientRouter = () => (
  <PatientWSProvider>
  <Routes>
    <Route index element={<PatientDashboard />} />
    <Route path="consultations" element={<ConsultationsPage />} />
    <Route path="consultation-room/:consultation_id" element={<PatientConsultationRoom />} />
    <Route path="medicine" element={<OrderMedicinePage />} />
    <Route path="medicine-orders" element={<MedicineOrdersPage />} />
    <Route path="lab" element={<LabTestPage />} />
    <Route path="test-records" element={<TestRecordsPage />} />
    <Route path="complaints" element={<ComplaintsPage />} />
    <Route path="ehr" element={<EHRWallet />} />
    <Route path="emergency" element={<EmergencyPage />} />
    <Route path="emergency-history" element={<EmergencyHistoryPage />} />
    <Route path="emergency-tracker/:emergency_id" element={<EmergencyTracker />} />
    <Route path="symptom-checker" element={<SymptomChecker />} />
    <Route path="risk" element={<RiskReport />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="*" element={<Navigate to="/patient" replace />} />
  </Routes>
  </PatientWSProvider>
);

export default PatientRouter;
