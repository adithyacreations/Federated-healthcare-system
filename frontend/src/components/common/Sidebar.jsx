import { NavLink } from 'react-router-dom';
import {
  FiHome, FiUsers, FiCheckSquare, FiActivity, FiAlertTriangle, FiFileText, FiSettings,
  FiUserCheck, FiPackage, FiGrid, FiCpu, FiBriefcase, FiCalendar, FiShoppingCart,
  FiHeart, FiFilePlus, FiTruck, FiClipboard, FiBookOpen, FiPhoneCall, FiList,
  FiMessageCircle, FiPlus, FiGlobe, FiBarChart2,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import useApi from '../../hooks/useApi';

const MENUS = {
  super_admin: [
    { to: '/admin', icon: FiHome, label: 'Dashboard', end: true, section: 'OVERVIEW' },
    { to: '/admin/approvals', icon: FiCheckSquare, label: 'Approvals', section: 'MANAGEMENT' },
    { to: '/admin/users', icon: FiUsers, label: 'Users', section: 'MANAGEMENT' },
    { to: '/admin/epidemic', icon: FiAlertTriangle, label: 'Epidemic Alerts', section: 'HEALTH', end: true },
    { to: '/admin/epidemic/resolved', icon: FiCheckSquare, label: 'Resolved Alerts', section: 'HEALTH' },
    { to: '/admin/epidemic/history', icon: FiActivity, label: 'Epidemic History', section: 'HEALTH' },
    { to: '/admin/fl', icon: FiCpu, label: 'FL Monitor', section: 'HEALTH' },
    { to: '/admin/complaints', icon: FiFileText, label: 'Complaints', section: 'SYSTEM' },
    { to: '/admin/website', icon: FiGlobe, label: 'Website Management', section: 'SYSTEM' },
    { to: '/admin/audit-logs', icon: FiFileText, label: 'Audit Logs', section: 'SYSTEM' },
    { to: '/admin/settings', icon: FiSettings, label: 'Settings', section: 'SYSTEM' },
    { to: '/profile', icon: FiUsers, label: 'Profile', section: 'ACCOUNT' },
  ],
  hospital_admin: [
    { to: '/hospital', icon: FiHome, label: 'Dashboard', end: true, section: 'MANAGEMENT' },
    { to: '/hospital/staff', icon: FiUserCheck, label: 'Staff', section: 'MANAGEMENT' },
    { to: '/hospital/schedule', icon: FiCalendar, label: 'Doctor Schedule', section: 'MANAGEMENT' },
    { to: '/hospital/beds', icon: FiGrid, label: 'Beds', section: 'MANAGEMENT' },
    { to: '/hospital/inventory', icon: FiPackage, label: 'Inventory', section: 'RESOURCES' },
    { to: '/hospital/departments', icon: FiBriefcase, label: 'Departments', section: 'RESOURCES' },
    { to: '/hospital/equipment-orders', icon: FiShoppingCart, label: 'Equipment Orders', section: 'RESOURCES' },
    { to: '/hospital/emergency', icon: FiAlertTriangle, label: 'Emergency Patients', section: 'OPERATIONS' },
    { to: '/hospital/lab-settings', icon: FiClipboard, label: 'Lab Settings', section: 'OPERATIONS' },
    { to: '/hospital/patients', icon: FiHeart, label: 'Hospital Patients', section: 'OPERATIONS' },
    { to: '/hospital/fl-client', icon: FiCpu, label: 'FL Client', section: 'OPERATIONS' },
    { to: '/hospital/complaints', icon: FiFileText, label: 'Complaints', section: 'OPERATIONS' },
    { to: '/profile', icon: FiUsers, label: 'Profile', section: 'OTHER' },
  ],
  doctor: [
    { to: '/doctor', icon: FiHome, label: 'Dashboard', end: true, section: 'CLINICAL' },
    { to: '/doctor/consultations', icon: FiPhoneCall, label: 'Consultations', section: 'CLINICAL' },
    { to: '/doctor/patients', icon: FiUsers, label: 'Patients', section: 'CLINICAL' },
    { to: '/doctor/prescriptions', icon: FiFilePlus, label: 'Prescriptions', section: 'CLINICAL' },
    { to: '/doctor/lab-orders', icon: FiClipboard, label: 'Lab Orders', section: 'CLINICAL' },
    { to: '/doctor/slots', icon: FiCalendar, label: 'Slots', section: 'MANAGEMENT' },
  ],
  patient: [
    { to: '/patient', icon: FiHome, label: 'Dashboard', end: true, section: 'MAIN' },
    { to: '/patient/consultations', icon: FiPhoneCall, label: 'Consultations', section: 'MAIN' },
    { to: '/patient/symptom-checker', icon: FiActivity, label: 'Symptom Checker', section: 'HEALTH' },
    { to: '/patient/medicine', icon: FiShoppingCart, label: 'Order Medicine', section: 'HEALTH' },
    { to: '/patient/lab', icon: FiActivity, label: 'Lab Tests', section: 'HEALTH' },
    { to: '/patient/ehr', icon: FiBookOpen, label: 'EHR Wallet', section: 'HEALTH' },
    { to: '/patient/medicine-orders', icon: FiPackage, label: 'Medicine Orders', section: 'ORDERS' },
    { to: '/patient/test-records', icon: FiClipboard, label: 'Test Records', section: 'ORDERS' },
    { to: '/patient/emergency', icon: FiAlertTriangle, label: 'SOS Emergency', section: 'EMERGENCY' },
    { to: '/patient/emergency-history', icon: FiList, label: 'Emergency History', section: 'EMERGENCY' },
    { to: '/patient/complaints', icon: FiFileText, label: 'Complaints', section: 'OTHER' },
    { to: '/profile', icon: FiUsers, label: 'Profile', section: 'OTHER' },
  ],
  pharmacist: [
    { to: '/pharmacist', icon: FiHome, label: 'Dashboard', end: true },
    { to: '/pharmacist/inventory', icon: FiPackage, label: 'Inventory' },
    { to: '/pharmacist/reports', icon: FiBarChart2, label: 'Monthly Report' },
    { to: '/profile', icon: FiUsers, label: 'Profile' },
  ],
  lab_tech: [
    { to: '/lab', icon: FiHome, label: 'Dashboard', end: true },
    { to: '/lab/orders', icon: FiClipboard, label: 'Test Orders' },
    { to: '/lab/reports', icon: FiFileText, label: 'Reports' },
    { to: '/lab/monthly-report', icon: FiBarChart2, label: 'Monthly Report' },
    { to: '/profile', icon: FiUsers, label: 'Profile' },
  ],
  driver: [
    { to: '/driver', icon: FiHome, label: 'Dashboard', end: true, section: 'MAIN' },
    { to: '/driver/active', icon: FiTruck, label: 'Active Dispatch', section: 'MAIN' },
    { to: '/driver/history', icon: FiList, label: 'Trip History', section: 'MAIN' },
  ],
  vendor: [
    { to: '/vendor', icon: FiHome, label: 'Dashboard', end: true, section: 'MAIN' },
    { to: '/vendor/messages', icon: FiMessageCircle, label: 'Messages', section: 'MAIN' },
    { to: '/vendor/products', icon: FiPackage, label: 'My Products', section: 'CATALOG' },
    { to: '/vendor/orders', icon: FiShoppingCart, label: 'Equipment Orders', section: 'ORDERS' },
    { to: '/vendor/profile', icon: FiUsers, label: 'Profile', section: 'OTHER' },
  ],
};

const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  doctor: 'Doctor',
  patient: 'Patient',
  pharmacist: 'Pharmacist',
  lab_tech: 'Lab Technician',
  driver: 'Ambulance Driver',
  vendor: 'Equipment Vendor',
};

const Sidebar = ({ collapsed = false, onClose }) => {
  const { role, user } = useAuth();
  const items = MENUS[role] || [];

  const fullName =
    user?.full_name || user?.name || user?.hospital_name || user?.company_name || user?.email || 'User';
  const initials = fullName.slice(0, 1).toUpperCase();

  // Group menu items by their (optional) section, preserving order. Roles
  // without sections fall into a single unlabelled group.
  const groups = [];
  items.forEach((it) => {
    const section = it.section || '';
    let group = groups.find((g) => g.section === section);
    if (!group) { group = { section, items: [] }; groups.push(group); }
    group.items.push(it);
  });

  const dashboard = useApi(role === 'super_admin' ? '/api/auth/admin-dashboard/' : null);
  const pendingCount = dashboard.data?.pending_approvals ?? 0;

  const labDashboard = useApi(role === 'lab_tech' ? '/api/lab/dashboard/' : null);
  const labPendingCount = labDashboard.data?.pending_orders ?? 0;

  const pharmacyCount = useApi(
    role === 'pharmacist' ? '/api/pharmacy/orders/pending-count/' : null,
    { pollInterval: 15000 },
  );
  const pharmacyPendingCount = pharmacyCount.data?.count ?? 0;

  const incoming = useApi(
    role === 'hospital_admin' ? '/api/emergency/incoming-patients/' : null,
    { pollInterval: 15000 },
  );
  const incomingCount = Array.isArray(incoming.data) ? incoming.data.length : 0;

  // Vendor chat unread count — uses the same /api/vendor/chats/ endpoint that
  // returns total_unread on the response envelope.
  // unwrap:false so we can read the envelope's total_unread field directly.
  const vendorChats = useApi(
    role === 'vendor' ? '/api/vendor/chats/' : null,
    { pollInterval: 30000, unwrap: false },
  );
  const vendorUnread = vendorChats.data?.total_unread ?? 0;

  // Patient — in-flight medicine orders for the ORDERS section badge.
  const patientOrders = useApi(
    role === 'patient' ? '/api/patient/medicine/orders/' : null,
    { pollInterval: 30000 },
  );
  const patientOrdersList = patientOrders.data?.orders || [];
  const patientPendingOrders = patientOrdersList.filter((o) =>
    ['pending', 'confirmed', 'dispatched', 'prescription_uploaded',
     'prescription_approved', 'verified', 'payment_pending'].includes(o.status)
  ).length;

  return (
    <aside
      className={`bg-white border-r border-hairline flex flex-col h-full transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <nav className="flex-1 overflow-y-auto py-3">
        {groups.map((group) => (
          <div key={group.section || 'default'}>
            {!collapsed && group.section && (
              <div className="px-4 pt-4 pb-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  {group.section}
                </p>
              </div>
            )}
            {group.items.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onClose}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-xl text-sm font-semibold transition-all border-l-2 ${
                isActive
                  ? 'bg-orange-50 text-orange-500 border-orange-500'
                  : 'text-muted border-transparent hover:bg-orange-50 hover:text-orange-500'
              } ${collapsed ? 'justify-center' : ''}`
            }
            title={collapsed ? label : undefined}
          >
            <Icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
            {!collapsed && to === '/admin/approvals' && pendingCount > 0 && (
              <span className="ml-auto text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none">
                {pendingCount}
              </span>
            )}
            {!collapsed && to === '/lab/orders' && labPendingCount > 0 && (
              <span className="ml-auto text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none">
                {labPendingCount}
              </span>
            )}
            {!collapsed && to === '/pharmacist' && pharmacyPendingCount > 0 && (
              <span className="ml-auto text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none">
                {pharmacyPendingCount > 9 ? '9+' : pharmacyPendingCount}
              </span>
            )}
            {!collapsed && to === '/hospital/emergency' && incomingCount > 0 && (
              <span className="ml-auto text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none animate-pulse">
                {incomingCount > 9 ? '9+' : incomingCount}
              </span>
            )}
            {!collapsed && to === '/vendor/messages' && vendorUnread > 0 && (
              <span className="ml-auto text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none">
                {vendorUnread > 9 ? '9+' : vendorUnread}
              </span>
            )}
            {!collapsed && to === '/patient/medicine-orders' && patientPendingOrders > 0 && (
              <span className="ml-auto text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded-full font-bold min-w-[18px] text-center leading-none">
                {patientPendingOrders > 9 ? '9+' : patientPendingOrders}
              </span>
            )}
          </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* Profile footer */}
      <div className="border-t border-hairline p-3">
        <div className={`flex items-center gap-3 rounded-xl px-2 py-2 bg-orange-50/60 ${collapsed ? 'justify-center' : ''}`}>
          {user?.profile_photo ? (
            <img src={user.profile_photo} alt={fullName} className="w-9 h-9 rounded-full object-cover ring-2 ring-orange-200 shrink-0" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center font-bricolage font-extrabold shrink-0">
              {initials}
            </span>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{fullName}</div>
              <span className="text-[10px] font-medium text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                {ROLE_LABELS[role] || role}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
