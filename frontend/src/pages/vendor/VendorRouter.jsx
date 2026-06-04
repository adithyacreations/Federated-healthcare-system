import { Routes, Route, Navigate } from 'react-router-dom';
import VendorDashboard from './VendorDashboard';
import VendorProductsPage from './VendorProductsPage';
import VendorOrdersPage from './VendorOrdersPage';
import VendorMessagesPage from './VendorMessagesPage';
import ProfilePage from '../profile/ProfilePage';

// Each section now has its own page; "Add Product" reuses the products page
// and auto-opens the modal via the /products/add route.
const VendorRouter = () => (
  <Routes>
    <Route index element={<VendorDashboard />} />
    <Route path="products" element={<VendorProductsPage />} />
    <Route path="products/add" element={<VendorProductsPage />} />
    <Route path="orders" element={<VendorOrdersPage />} />
    <Route path="messages" element={<VendorMessagesPage />} />
    <Route path="profile" element={<ProfilePage />} />
    <Route path="*" element={<Navigate to="/vendor" replace />} />
  </Routes>
);

export default VendorRouter;
