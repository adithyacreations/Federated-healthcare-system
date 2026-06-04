import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import LoadingSpinner from './LoadingSpinner';

const ROLE_HOME = {
  super_admin: '/admin',
  hospital_admin: '/hospital',
  doctor: '/doctor',
  patient: '/patient',
  pharmacist: '/pharmacist',
  lab_tech: '/lab',
  driver: '/driver',
  vendor: '/vendor',
};

const ProtectedRoute = ({ allowedRole, children }) => {
  const { isAuthenticated, role, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingSpinner />;

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (allowedRole && role && role !== allowedRole) {
    const home = ROLE_HOME[role] || '/';
    return <Navigate to={home} replace />;
  }

  return children;
};

export const DashboardRouter = () => {
  const { isAuthenticated, role, loading } = useAuth();
  if (loading) return <LoadingSpinner />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={ROLE_HOME[role] || '/'} replace />;
};

export default ProtectedRoute;
