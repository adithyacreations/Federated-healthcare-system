import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FiBell, FiUser, FiLogOut, FiMenu, FiX, FiChevronDown } from 'react-icons/fi';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '../../context/AuthContext';
import API from '../../api/axios';

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

const Navbar = ({ onToggleSidebar }) => {
  const { user, role, logout, isAuthenticated } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const profileRef = useRef(null);
  const notifRef = useRef(null);

  const fetchNotifications = async () => {
    try {
      const res = await API.get('/api/auth/notifications/');
      const list = res.data?.data || [];
      setNotifications(list);
      setUnreadCount(list.filter((n) => !n.is_read).length);
    } catch (_) {}
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    return () => clearInterval(timer);
  }, [isAuthenticated]);

  useEffect(() => {
    const handler = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMarkRead = async (notifId) => {
    try {
      await API.put(`/api/auth/notifications/${notifId}/read/`);
      setNotifications((prev) =>
        prev.map((n) => (n.notif_id === notifId ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (_) {}
  };

  const handleMarkAllRead = async () => {
    try {
      await API.get('/api/auth/notifications/?mark_all_read=true');
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (_) {}
  };

  const relTime = (iso) => {
    try {
      return formatDistanceToNow(new Date(iso), { addSuffix: true });
    } catch {
      return '';
    }
  };

  const fullName =
    user?.full_name ||
    user?.name ||
    user?.hospital_name ||
    user?.company_name ||
    user?.email ||
    'User';
  const homePath = ROLE_HOME[role] || '/';

  return (
    <nav className="bg-white text-ink border-b border-hairline shadow-sm sticky top-0 z-30">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Left: sidebar toggle + logo */}
          <div className="flex items-center gap-3">
            {isAuthenticated && onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="p-2 rounded-lg hover:bg-orange-50 text-ink transition lg:hidden"
                aria-label="Open menu"
              >
                <FiMenu className="w-5 h-5" />
              </button>
            )}
            <Link to={homePath} className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center font-bricolage font-extrabold">F</span>
              <span className="font-bricolage text-xl font-extrabold tracking-tight text-ink">
                Feder<span className="text-orange-500">Care</span>
              </span>
            </Link>
          </div>

          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              {/* Notifications bell */}
              <div className="relative" ref={notifRef}>
                <button
                  onClick={() => setNotifOpen((v) => !v)}
                  className="relative p-2 rounded-full hover:bg-orange-50 transition"
                  aria-label="Notifications"
                >
                  <FiBell className="w-5 h-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 bg-danger text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-semibold">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border border-gray-100 overflow-hidden text-gray-700 z-50">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                      <span className="font-semibold text-ink text-sm">Notifications</span>
                      {unreadCount > 0 && (
                        <button
                          onClick={handleMarkAllRead}
                          className="text-xs text-blue-500 hover:text-primary-500 font-medium transition"
                        >
                          Mark All Read
                        </button>
                      )}
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                      {notifications.length === 0 ? (
                        <div className="py-10 text-center text-gray-400 text-sm">
                          No new notifications 🔔
                        </div>
                      ) : (
                        notifications.slice(0, 20).map((n) => (
                          <button
                            key={n.notif_id}
                            onClick={() => handleMarkRead(n.notif_id)}
                            className={`w-full text-left px-4 py-3 hover:bg-orange-50 transition ${
                              !n.is_read ? 'bg-blue-50/60' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div
                                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                                  !n.is_read ? 'bg-blue-500' : 'bg-gray-200'
                                }`}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="font-semibold text-sm text-gray-800 truncate">
                                  {n.title}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
                                  {n.message}
                                </div>
                                <div className="text-[11px] text-gray-400 mt-1">
                                  {relTime(n.created_at)}
                                </div>
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Profile dropdown */}
              <div className="relative" ref={profileRef}>
                <button
                  onClick={() => setProfileOpen((v) => !v)}
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-orange-50 transition"
                >
                  {user?.profile_photo ? (
                    <img
                      src={user.profile_photo}
                      alt="Profile"
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-orange-500"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-sm">
                      {fullName.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="hidden sm:block text-left leading-tight">
                    <div className="text-sm font-medium truncate max-w-[140px]">{fullName}</div>
                    <div className="text-[11px] opacity-70">{ROLE_LABELS[role] || role}</div>
                  </div>
                  <FiChevronDown className="w-4 h-4 opacity-70" />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-hover border border-gray-100 overflow-hidden text-gray-700">
                    <div className="px-4 py-3 border-b border-gray-100">
                      <div className="font-medium truncate">{fullName}</div>
                      <div className="text-xs text-gray-500">{ROLE_LABELS[role] || role}</div>
                    </div>
                    <Link
                      to="/profile"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-orange-50 text-sm"
                    >
                      <FiUser className="w-4 h-4" /> Profile
                    </Link>
                    <button
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                      }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-red-50 text-danger text-sm"
                    >
                      <FiLogOut className="w-4 h-4" /> Logout
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-2">
              <Link
                to="/login"
                className="px-4 py-1.5 rounded-xl hover:bg-orange-50 transition text-sm font-medium"
              >
                Login
              </Link>
              <Link
                to="/register/patient"
                className="bg-orange-500 text-white px-4 py-1.5 rounded-full text-sm font-semibold hover:bg-orange-600 transition"
              >
                Sign Up
              </Link>
            </div>
          )}

          {!isAuthenticated && (
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="sm:hidden p-2 rounded-lg hover:bg-orange-50 transition"
              aria-label="Toggle menu"
            >
              {mobileOpen ? <FiX className="w-5 h-5" /> : <FiMenu className="w-5 h-5" />}
            </button>
          )}
        </div>

        {!isAuthenticated && mobileOpen && (
          <div className="sm:hidden pb-3 flex flex-col gap-1">
            <Link to="/login" className="px-3 py-2 rounded-lg hover:bg-orange-50 text-sm">
              Login
            </Link>
            <Link
              to="/register/patient"
              className="px-3 py-2 rounded-lg hover:bg-orange-50 text-sm"
            >
              Patient Sign Up
            </Link>
            <Link
              to="/register/hospital"
              className="px-3 py-2 rounded-lg hover:bg-orange-50 text-sm"
            >
              Hospital Sign Up
            </Link>
            <Link
              to="/register/pharmacist"
              className="px-3 py-2 rounded-lg hover:bg-orange-50 text-sm"
            >
              Pharmacist Sign Up
            </Link>
            <Link
              to="/register/vendor"
              className="px-3 py-2 rounded-lg hover:bg-orange-50 text-sm"
            >
              Vendor Sign Up
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
