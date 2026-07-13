import { useState, useRef, useEffect } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiGrid, FiCalendar, FiUsers, FiFilePlus, FiClipboard,
  FiBell, FiSearch, FiLogOut, FiUser, FiMenu, FiX,
} from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import API from '../../api/axios';
import { T } from './ui';
import { cleanDoctorName } from '../../utils/nameUtils';

const NAV = [
  {
    section: 'CLINICAL',
    items: [
      { to: '/doctor', label: 'Dashboard', icon: FiGrid, end: true },
      { to: '/doctor/consultations', label: 'Appointments', icon: FiCalendar },
      { to: '/doctor/patients', label: 'Patients', icon: FiUsers },
      { to: '/doctor/prescriptions', label: 'Prescriptions', icon: FiFilePlus },
      { to: '/doctor/lab-orders', label: 'Lab Tests', icon: FiClipboard },
    ],
  },
  {
    section: 'MANAGEMENT',
    items: [
      { to: '/doctor/slots', label: 'Schedule', icon: FiCalendar },
    ],
  },
];

// ─── Sidebar ────────────────────────────────────────────────────────────────
const DoctorSidebar = ({ onNavigate }) => (
  <aside
    className="w-[220px] shrink-0 flex flex-col h-full"
    style={{ backgroundColor: '#fff', borderRight: `1px solid ${T.border}` }}
  >
    <div className="flex items-center gap-2 px-5 h-16" style={{ borderBottom: `1px solid ${T.border}` }}>
      <span
        className="w-8 h-8 rounded-lg text-white flex items-center justify-center font-extrabold"
        style={{ backgroundColor: T.orange }}
      >
        F
      </span>
      <span className="text-lg font-extrabold tracking-tight" style={{ color: T.dark }}>
        Feder<span style={{ color: T.orange }}>Care</span>
      </span>
    </div>

    <nav className="flex-1 overflow-y-auto py-4">
      {NAV.map((group) => (
        <div key={group.section} className="mb-4">
          <p className="px-5 mb-1.5 text-[11px] font-bold tracking-wider" style={{ color: '#9ca3af' }}>
            {group.section}
          </p>
          {group.items.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className="flex items-center gap-3 px-5 py-2.5 text-sm font-medium transition-all"
              style={({ isActive }) => ({
                color: isActive ? T.orange : T.sub,
                backgroundColor: isActive ? T.tint : 'transparent',
                borderLeft: `3px solid ${isActive ? T.orange : 'transparent'}`,
              })}
            >
              <item.icon className="w-[18px] h-[18px] shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  </aside>
);

// ─── Notifications bell (reuses shared API) ─────────────────────────────────
const NotificationBell = () => {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef(null);

  const fetchNotifs = async () => {
    try {
      const res = await API.get('/api/auth/notifications/');
      const list = res.data?.data || [];
      setItems(list);
      setUnread(list.filter((n) => !n.is_read).length);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchNotifs();
    const t = setInterval(fetchNotifs, 30000);
    return () => clearInterval(t);
  }, [isAuthenticated]);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const markRead = async (id) => {
    try {
      await API.put(`/api/auth/notifications/${id}/read/`);
      setItems((p) => p.map((n) => (n.notif_id === id ? { ...n, is_read: true } : n)));
      setUnread((p) => Math.max(0, p - 1));
    } catch { /* ignore */ }
  };

  const rel = (iso) => { try { return formatDistanceToNow(new Date(iso), { addSuffix: true }); } catch { return ''; } };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-full transition hover:bg-orange-50"
        aria-label="Notifications"
      >
        <FiBell className="w-5 h-5" style={{ color: T.dark }} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center font-semibold">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-2xl border overflow-hidden z-50" style={{ borderColor: T.border }}>
          <div className="px-4 py-3 font-semibold text-sm" style={{ borderBottom: `1px solid ${T.border}`, color: T.dark }}>
            Notifications
          </div>
          <div className="max-h-80 overflow-y-auto divide-y" style={{ borderColor: '#f3f4f6' }}>
            {items.length === 0 ? (
              <div className="py-10 text-center text-gray-400 text-sm">No notifications 🔔</div>
            ) : (
              items.slice(0, 20).map((n) => (
                <button
                  key={n.notif_id}
                  onClick={() => markRead(n.notif_id)}
                  className="w-full text-left px-4 py-3 hover:bg-orange-50 transition"
                  style={{ backgroundColor: n.is_read ? '#fff' : T.tint }}
                >
                  <div className="font-semibold text-sm truncate" style={{ color: T.dark }}>{n.title}</div>
                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: T.sub }}>{n.message}</div>
                  <div className="text-[11px] text-gray-400 mt-1">{rel(n.created_at)}</div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Top navbar ─────────────────────────────────────────────────────────────
const DoctorTopbar = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setProfileOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const name = user?.full_name || user?.name || user?.email || 'Doctor';
  const spec = user?.specialization || 'Doctor';

  return (
    <header
      className="h-16 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-20"
      style={{ backgroundColor: '#fff', borderBottom: `1px solid ${T.border}` }}
    >
      {/* Left: mobile toggle + search */}
      <div className="flex items-center gap-3">
        <button onClick={onToggleSidebar} className="lg:hidden p-2 rounded-lg hover:bg-orange-50" aria-label="Menu">
          <FiMenu className="w-5 h-5" style={{ color: T.dark }} />
        </button>
        <div className="hidden sm:flex items-center gap-2 bg-gray-100 rounded-full px-4 py-2 w-72 lg:w-80">
          <FiSearch className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            placeholder="Search patients, appointments..."
            className="bg-transparent text-sm outline-none flex-1"
            style={{ color: T.sub }}
          />
          <kbd className="text-xs text-gray-400 bg-white px-2 py-0.5 rounded-md border border-gray-200">⌘K</kbd>
        </div>
      </div>

      {/* Right: AI assistant + bell + profile */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={() => toast('AI Assistant is available in the consultation room ✨', { icon: '✨' })}
          className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-medium"
          style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.orangeDark})` }}
        >
          ✨ AI Assistant
        </button>

        <NotificationBell />

        <div className="relative" ref={ref}>
          <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-orange-50 transition">
            {user?.profile_photo ? (
              <img src={user.profile_photo} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-orange-500" />
            ) : (
              <div className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-sm" style={{ backgroundColor: T.orange }}>
                {name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="hidden sm:block text-left leading-tight">
              <div className="text-sm font-bold truncate max-w-[140px]" style={{ color: T.dark }}>{cleanDoctorName(name)}</div>
              <div className="text-[11px]" style={{ color: T.sub }}>{spec}</div>
            </div>
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-white rounded-xl shadow-2xl border overflow-hidden z-50" style={{ borderColor: T.border }}>
              <Link to="/profile" onClick={() => setProfileOpen(false)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-orange-50 text-sm" style={{ color: T.dark }}>
                <FiUser className="w-4 h-4" /> Profile
              </Link>
              <button onClick={() => { setProfileOpen(false); logout(); }} className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-red-50 text-red-600 text-sm">
                <FiLogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

// ─── Layout shell ───────────────────────────────────────────────────────────
const DoctorLayout = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: T.bg }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex h-screen sticky top-0">
        <DoctorSidebar />
      </div>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full">
            <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-[-44px] p-2 bg-white rounded-full shadow">
              <FiX className="w-5 h-5" />
            </button>
            <DoctorSidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <DoctorTopbar onToggleSidebar={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8" style={{ backgroundColor: T.bg }}>
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default DoctorLayout;
