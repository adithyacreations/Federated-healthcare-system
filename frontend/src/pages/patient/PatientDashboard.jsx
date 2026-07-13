import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiFilePlus, FiCalendar, FiClipboard, FiShoppingCart,
  FiActivity, FiBookOpen, FiAlertTriangle, FiFileText, FiArrowRight,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import StatsCard from '../../components/dashboard/StatsCard';
import ActivityItem from '../../components/dashboard/ActivityItem';
import HealthScoreRing from '../../components/patient/HealthScoreRing';
import AIHealthSummary from '../../components/patient/AIHealthSummary';
import { pageVariants, cardVariants, cardHover } from '../../components/dashboard/variants';
import Badge from '../../components/common/Badge';
import useApi from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { cleanDoctorName } from '../../utils/nameUtils';

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
};

// A consultation is joinable from its start time until 2 hours after.
const isJoinableNow = (c) => {
  if (!c?.slot_date || !c?.slot_time) return false;
  const start = new Date(`${c.slot_date}T${c.slot_time}`);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const now = new Date();
  return now >= start && now <= end;
};

// Bento quick-action tile. `span`/`danger` control size & treatment.
const BentoAction = ({ icon: Icon, title, description, to, span = '', danger }) => (
  <motion.div variants={cardVariants} whileHover={danger ? undefined : cardHover} className={span}>
    <Link
      to={to}
      className={`group relative h-full min-h-[120px] flex flex-col justify-between rounded-2xl border p-5 overflow-hidden transition-colors ${
        danger
          ? 'bg-red-500 border-red-500 text-white'
          : 'bg-white border-hairline hover:border-orange-400'
      }`}
    >
      {danger && (
        <>
          <span className="absolute -right-6 -top-6 w-24 h-24 rounded-full bg-white/20 animate-ping" />
          <span className="absolute -right-2 -top-2 w-16 h-16 rounded-full bg-white/10" />
        </>
      )}
      <div className={`relative w-11 h-11 rounded-xl flex items-center justify-center ${
        danger ? 'bg-white/20' : 'bg-orange-50 text-orange-500'
      }`}>
        <Icon className={`w-6 h-6 ${danger ? 'text-white' : ''}`} />
      </div>
      <div className="relative mt-3">
        <div className={`font-bricolage font-bold ${danger ? 'text-white text-lg' : 'text-ink'}`}>{title}</div>
        <div className={`text-sm flex items-center gap-1 ${danger ? 'text-white/80' : 'text-muted'}`}>
          {description}
          <FiArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
      </div>
    </Link>
  </motion.div>
);

const PatientDashboard = () => {
  const { user } = useAuth();
  // Auto-refresh dashboard data every 30s so stats / next consultation stay current.
  const dash = useApi('/api/patient/dashboard/', { pollInterval: 30000 });
  const medicineOrders = useApi('/api/patient/medicine/orders/', { pollInterval: 30000 });

  const [activity, setActivity] = useState([]);
  const wsRef = useRef(null);

  const d = dash.data || {};
  const medCount = (medicineOrders.data?.orders || []).length;

  // Derive a friendly health score from BMI (closest to 22 = best).
  const bmi = Number(d.bmi);
  const healthScore = Number.isFinite(bmi)
    ? Math.max(45, Math.min(99, Math.round(100 - Math.abs(bmi - 22) * 4)))
    : 80;

  const nextConsult = (d.upcoming_consultations || [])[0];

  // Live "X minutes away" countdown for the next consultation banner.
  const [timeUntil, setTimeUntil] = useState('');
  useEffect(() => {
    if (!nextConsult?.slot_date || !nextConsult?.slot_time) {
      setTimeUntil('');
      return undefined;
    }
    const update = () => {
      const target = new Date(`${nextConsult.slot_date}T${nextConsult.slot_time}`);
      const diff = target - new Date();
      if (Number.isNaN(diff)) { setTimeUntil(''); return; }
      if (diff <= 0) { setTimeUntil('Starting now!'); return; }
      const totalMin = Math.floor(diff / 60000);
      const hours = Math.floor(totalMin / 60);
      const minutes = totalMin % 60;
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        setTimeUntil(`${days} day${days > 1 ? 's' : ''} away`);
      } else if (hours > 0) {
        setTimeUntil(`${hours}h ${minutes}m away`);
      } else {
        setTimeUntil(`${minutes} minutes away`);
      }
    };
    update();
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [nextConsult?.slot_date, nextConsult?.slot_time]);

  useEffect(() => {
    if (d.recent_ehr_records) {
      setActivity((prev) => {
        if (prev.length) return prev;
        return d.recent_ehr_records.slice(0, 5).map((r) => ({
          text: `${r.record_type}: ${r.title}`,
          at: r.recorded_at,
          type: 'ehr',
        }));
      });
    }
  }, [d.recent_ehr_records]);

  useEffect(() => {
    const loginId = user?.login_id;
    if (!loginId) return undefined;

    let ws;
    try {
      ws = new WebSocket(`ws://localhost:8000/ws/notifications/${loginId}/`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        const title = msg.title || 'Update';
        const text = msg.message || '';
        toast(`${title}${text ? ' — ' + text : ''}`, { icon: '🔔' });
        setActivity((prev) =>
          [{ text: `${title}: ${text}`, at: new Date().toISOString(), type: 'order' }, ...prev].slice(0, 5));
        if (msg.notif_type === 'order' || msg.type === 'order_update') medicineOrders.refetch();
      };
      ws.onerror = () => { /* best-effort — silent */ };
    } catch {
      /* WebSocket unavailable — dashboard still works */
    }
    return () => { try { ws?.close(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login_id]);

  const safeFmt = (iso) => {
    if (!iso) return '';
    try { return format(new Date(iso), 'dd MMM, HH:mm'); } catch { return iso; }
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* ─── SECTION A — Welcome hero ──────────────────────────── */}
        <motion.section
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 90, damping: 16 }}
          className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-cream p-6 sm:p-8 mb-6 flex flex-wrap items-center justify-between gap-6"
        >
          <div className="min-w-0">
            <p className="text-sm text-muted">{greeting()} 👋</p>
            <h1 className="font-bricolage text-3xl sm:text-4xl font-extrabold text-ink mt-0.5">
              {d.patient_name || '...'}
            </h1>
            <p className="text-muted mt-1">Stay healthy today!</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              {d.blood_group && (
                <span className="bg-red-50 text-red-600 border border-red-100 px-3 py-1 rounded-full font-medium">
                  🩸 {d.blood_group}
                </span>
              )}
              {d.bmi != null && (
                <span className="bg-blue-50 text-blue-600 border border-blue-100 px-3 py-1 rounded-full font-medium">
                  BMI {d.bmi}
                </span>
              )}
              {d.age != null && (
                <span className="bg-white text-muted border border-hairline px-3 py-1 rounded-full font-medium">
                  Age {d.age}
                </span>
              )}
            </div>
          </div>
          <HealthScoreRing score={healthScore} />
        </motion.section>

        {/* ─── Repeated no-show warning ──────────────────────────── */}
        {d.no_show_warning && (
          <div className="rounded-2xl p-4 mb-6 flex items-center gap-3" style={{ backgroundColor: '#FEF2F2', border: '1.5px solid #FCA5A5' }}>
            <span style={{ fontSize: 28 }}>⚠️</span>
            <div>
              <p className="font-bold m-0 mb-1" style={{ color: '#EF4444', fontSize: 15 }}>Multiple Missed Appointments</p>
              <p className="text-gray-600 m-0" style={{ fontSize: 13, lineHeight: 1.5 }}>
                You have missed <b>{d.monthly_no_shows}</b> lab appointments this month.
                Please ensure you attend your booked tests or cancel in advance.
              </p>
            </div>
          </div>
        )}

        {/* ─── Next consultation countdown banner ────────────────── */}
        {nextConsult && (
          <motion.div
            variants={cardVariants}
            className="rounded-2xl p-4 mb-6 border-2"
            style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-xs font-medium mb-1" style={{ color: '#EA580C' }}>
                  ⏰ Next Consultation
                </p>
                <p className="font-bold text-black">{cleanDoctorName(nextConsult.doctor_name)}</p>
                <p className="text-sm text-gray-500">
                  {nextConsult.slot_date} at {nextConsult.slot_time}
                </p>
              </div>
              <div className="text-right">
                {isJoinableNow(nextConsult) ? (
                  <Link
                    to="/patient/consultations"
                    className="inline-block px-6 py-2.5 rounded-full font-bold text-white text-sm animate-pulse"
                    style={{ backgroundColor: '#F97316' }}
                  >
                    🎥 Join Now
                  </Link>
                ) : (
                  <p className="font-bold text-lg" style={{ color: '#F97316' }}>
                    {timeUntil}
                  </p>
                )}
                {nextConsult.consult_type === 'online' && (
                  <p className="text-xs text-gray-400 mt-1">💻 Online</p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ─── SECTION B — Stats row ─────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard icon={FiCalendar}     title="Consultations" value={d.total_consultations ?? 0} trend={8} />
          <StatsCard icon={FiFilePlus}     title="Prescriptions" value={d.total_prescriptions ?? 0} />
          <StatsCard icon={FiActivity}     title="Lab Tests"     value={d.total_lab_orders ?? 0} />
          <StatsCard icon={FiShoppingCart} title="Orders"        value={medCount} />
        </div>

        {/* ─── AI Health Summary widget ──────────────────────────── */}
        <div className="mb-8">
          <AIHealthSummary />
        </div>

        {/* ─── SECTION C — Bento quick actions ───────────────────── */}
        <section className="mb-8">
          <h2 className="dash-h2">Quick Actions</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 auto-rows-fr">
            <BentoAction to="/patient/consultations" icon={FiCalendar}     title="Book Consultation" description="Telemedicine"   span="col-span-2" />
            <BentoAction to="/patient/lab"           icon={FiActivity}     title="Lab Test"          description="Diagnostics" />
            <BentoAction to="/patient/ehr"           icon={FiBookOpen}     title="EHR Wallet"        description="Health records" />
            <BentoAction to="/patient/medicine"      icon={FiShoppingCart} title="Order Med"         description="Pharmacy" />
            <BentoAction to="/patient/complaints"    icon={FiFileText}     title="Complaint"         description="Doctor / vendor" />
            <BentoAction to="/patient/emergency"     icon={FiAlertTriangle} title="🚨 Emergency SOS" description="Tap for immediate help" span="col-span-2" danger />
          </div>
        </section>

        {/* ─── SECTION D — Next consultation ─────────────────────── */}
        {nextConsult && (
          <motion.section variants={cardVariants} className="mb-8">
            <h2 className="dash-h2">Next Consultation</h2>
            <div className="dashboard-card flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white flex items-center justify-center font-bricolage font-extrabold text-xl shrink-0">
                  {(nextConsult.doctor_name || 'D').slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="font-bricolage font-bold text-ink truncate">{cleanDoctorName(nextConsult.doctor_name)}</div>
                  <div className="text-sm text-muted truncate">{nextConsult.specialization}</div>
                  {nextConsult.hospital_name && (
                    <div className="text-xs text-muted truncate">{nextConsult.hospital_name}</div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold text-ink">{nextConsult.slot_date}</div>
                <div className="text-orange-500 font-semibold">{nextConsult.slot_time}</div>
                <div className="mt-2 flex items-center gap-2 justify-end">
                  <Badge status={nextConsult.status} />
                  <Link to="/patient/consultations" className="btn-orange text-xs !px-4 !py-2">Open</Link>
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {/* ─── SECTION E — Recent activity ───────────────────────── */}
        <section>
          <h2 className="dash-h2">Recent Activity</h2>
          <motion.div variants={cardVariants} className="dashboard-card">
            {activity.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">No recent activity.</p>
            ) : (
              activity.slice(0, 5).map((a, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                >
                  <ActivityItem text={a.text} time={safeFmt(a.at)} type={a.type} />
                </motion.div>
              ))
            )}
          </motion.div>
        </section>
      </motion.div>
    </DashboardLayout>
  );
};

export default PatientDashboard;
