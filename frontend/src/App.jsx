import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/auth/LoginPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import PatientRegisterPage from './pages/auth/PatientRegisterPage';
import HospitalRegisterPage from './pages/auth/HospitalRegisterPage';
import PharmacistRegisterPage from './pages/auth/PharmacistRegisterPage';
import VendorRegisterPage from './pages/auth/VendorRegisterPage';
import PlaceholderPage from './pages/PlaceholderPage';
import SuperAdminRouter from './pages/admin/SuperAdminRouter';
import ProfilePage from './pages/profile/ProfilePage';
import HospitalRouter from './pages/hospital/HospitalRouter';
import PatientRouter from './pages/patient/PatientRouter';
import QRInfoPage from './pages/patient/QRInfoPage';
import DoctorRouter from './pages/doctor/DoctorRouter';
import PharmacistRouter from './pages/pharmacist/PharmacistRouter';
import LabRouter from './pages/lab/LabRouter';
import DriverRouter from './pages/driver/DriverRouter';
import VendorRouter from './pages/vendor/VendorRouter';
import ProtectedRoute, { DashboardRouter } from './components/common/ProtectedRoute';
import FederCareChatbot from './components/chatbot/FederCareChatbot';

const RoleHome = ({ role, label, children }) => (
  <ProtectedRoute allowedRole={role}>
    {children || <PlaceholderPage title={`${label} Dashboard`} />}
  </ProtectedRoute>
);

const App = () => (
  <AuthProvider>
    <BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: { borderRadius: '12px', fontSize: '14px' },
        }}
      />
      <Routes>
        {/* Public */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/register/patient" element={<PatientRegisterPage />} />
        <Route path="/register/hospital" element={<HospitalRegisterPage />} />
        <Route path="/register/pharmacist" element={<PharmacistRegisterPage />} />
        <Route path="/register/vendor" element={<VendorRegisterPage />} />

        {/* Public QR info — scanned from a patient QR code, no auth required */}
        <Route path="/patient/qr/:token" element={<QRInfoPage />} />

        {/* Post-login redirect helper */}
        <Route path="/dashboard" element={<DashboardRouter />} />

        {/* Universal profile page — all authenticated roles */}
        <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />

        {/* Protected role areas — splat routes so each role can have nested pages later */}
        <Route path="/admin/*" element={<RoleHome role="super_admin" label="Super Admin"><SuperAdminRouter /></RoleHome>} />
        <Route path="/hospital/*" element={<RoleHome role="hospital_admin" label="Hospital"><HospitalRouter /></RoleHome>} />
        <Route path="/doctor/*" element={<RoleHome role="doctor" label="Doctor"><DoctorRouter /></RoleHome>} />
        <Route path="/patient/*" element={<RoleHome role="patient" label="Patient"><PatientRouter /></RoleHome>} />
        <Route path="/pharmacist/*" element={<RoleHome role="pharmacist" label="Pharmacist"><PharmacistRouter /></RoleHome>} />
        <Route path="/lab/*" element={<RoleHome role="lab_tech" label="Lab Technician"><LabRouter /></RoleHome>} />
        <Route path="/driver/*" element={<RoleHome role="driver" label="Driver"><DriverRouter /></RoleHome>} />
        <Route path="/vendor/*" element={<RoleHome role="vendor" label="Vendor"><VendorRouter /></RoleHome>} />

        {/* Catch-all */}
        <Route path="*" element={<LandingPage />} />
      </Routes>
      <FederCareChatbot />
    </BrowserRouter>
  </AuthProvider>
);

export default App;
