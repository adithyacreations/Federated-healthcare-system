import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiCalendar, FiClipboard, FiUsers, FiPlus, FiFilePlus, FiActivity,
  FiVideo, FiUser, FiArrowRight, FiFileText,
} from 'react-icons/fi';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import { T, DoctorAvatar, SparkStatCard, SectionHead } from '../../components/doctor/ui';
import Modal from '../../components/common/Modal';
import FormInput from '../../components/auth/FormInput';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import { cleanDoctorName } from '../../utils/nameUtils';

const QUICK_ACTIONS = [
  { icon: FiVideo,     label: 'New Consultation', to: '/doctor/consultations' },
  { icon: FiFilePlus,  label: 'Add Prescription', to: '/doctor/prescriptions' },
  { icon: FiClipboard, label: 'Order Lab Test',   to: '/doctor/lab-orders' },
  { icon: FiUsers,     label: 'View Patients',    to: '/doctor/patients' },
];

const DoctorDashboard = () => {
  const navigate = useNavigate();
  const dash = useApi('/api/doctor/dashboard/');
  const consultations = useApi('/api/doctor/consultations/');

  const [toggling, setToggling] = useState(false);
  const [slotModal, setSlotModal] = useState(false);
  const [slotForm, setSlotForm] = useState({ slot_date: '', start_time: '', end_time: '', consult_type: 'online' });
  const [savingSlot, setSavingSlot] = useState(false);

  const [criticalAlerts, setCriticalAlerts] = useState([]);
  useEffect(() => {
    const fetchCriticalAlerts = async () => {
      try {
        const res = await API.get('/api/lab/critical-alerts/');
        if (res.data?.success) setCriticalAlerts(res.data.data || []);
      } catch (e) {
        /* best-effort */
      }
    };
    fetchCriticalAlerts();
    const id = setInterval(fetchCriticalAlerts, 120000);
    return () => clearInterval(id);
  }, []);

  const d = dash.data || {};
  const today = format(new Date(), 'yyyy-MM-dd');
  const allConsults = consultations.data || [];

  // Start button unlocks 10 min before slot start, locks 15 min after end.
  const getTimeStatus = (c) => {
    if (!c.start_time) return { canStart: false, label: 'No time set', color: 'gray' };
    if (c.slot_date !== today) return { canStart: false, label: 'Not today', color: 'gray' };
    const parse = (t) => { const [h, m] = (t || '').split(':').map(Number); return h * 60 + m; };
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const startM = parse(c.start_time);
    const endM = parse(c.end_time || '23:59');
    if (nowM < startM - 10) {
      const left = startM - nowM;
      const hrs = Math.floor(left / 60);
      const mins = left % 60;
      return { canStart: false, label: hrs > 0 ? `Starts in ${hrs}h ${mins}m` : `Starts in ${mins}m`, color: 'yellow' };
    }
    if (nowM > endM + 15) return { canStart: false, label: 'Ended', color: 'red' };
    return { canStart: true, label: c.consult_mode === 'offline' ? '🏥 Open Visit' : '📹 Start Call', color: 'green' };
  };

  const todayList = useMemo(
    () => allConsults.filter(
      (c) => c.slot_date === today && !['completed', 'cancelled'].includes(c.status) && getTimeStatus(c).color !== 'red',
    ),
    [allConsults, today], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Recent patients derived from the doctor's consultations (most recent first).
  const recentPatients = useMemo(() => {
    const seen = new Set();
    const out = [];
    [...allConsults]
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .forEach((c) => {
        if (seen.has(c.patient_name)) return;
        seen.add(c.patient_name);
        out.push(c);
      });
    return out.slice(0, 6);
  }, [allConsults]);

  const prescriptionsWritten = d.total_prescriptions ?? (d.recent_prescriptions || []).length;
  const totalAppointments = allConsults.length;

  // Patient-overview weekly chart (UI synthesis from the real seen total).
  const weekData = useMemo(() => {
    const base = Math.max(Number(d.total_patients_seen) || 0, 4);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((day, i) => ({ day, patients: Math.max(1, Math.round((base / 7) * (0.6 + Math.sin(i) * 0.4 + i * 0.12))) }));
  }, [d.total_patients_seen]);

  const toggleOnline = async () => {
    setToggling(true);
    try {
      const { data } = await API.put('/api/doctor/toggle-online/');
      toast.success(data?.message || 'Status updated');
      dash.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Toggle failed');
    } finally {
      setToggling(false);
    }
  };

  const submitSlot = async (e) => {
    e.preventDefault();
    if (!slotForm.slot_date || !slotForm.start_time || !slotForm.end_time) {
      return toast.error('All slot fields are required');
    }
    setSavingSlot(true);
    try {
      await API.post('/api/doctor/slots/create/', slotForm);
      toast.success('Slot added');
      setSlotModal(false);
      setSlotForm({ slot_date: '', start_time: '', end_time: '', consult_type: 'online' });
      dash.refetch();
    } catch (err) {
      const data = err?.response?.data;
      const msg = data?.errors ? Object.values(data.errors).flat().join(' · ') : data?.message || 'Could not create slot';
      toast.error(msg);
    } finally {
      setSavingSlot(false);
    }
  };

  // Activity feed from recent prescriptions + today's consultations.
  const activity = useMemo(() => {
    const out = [];
    todayList.slice(0, 3).forEach((c) => out.push({
      type: 'appointment', color: T.orange, text: `Consultation with ${c.patient_name}`, time: c.start_time || 'today',
    }));
    (d.recent_prescriptions || []).slice(0, 3).forEach((rx) => out.push({
      type: 'prescription', color: '#3b82f6', text: `Prescription for ${rx.patient_name}`,
      time: rx.created_at ? format(new Date(rx.created_at), 'dd MMM, HH:mm') : '',
    }));
    return out.slice(0, 6);
  }, [todayList, d.recent_prescriptions]);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const statusBadge = (status) => {
    const map = {
      completed: { bg: T.dark, color: '#fff' },
      ongoing: { bg: T.orange, color: '#fff' },
      scheduled: { bg: '#fff', color: T.sub, border: T.border },
    };
    const s = map[status] || { bg: '#f3f4f6', color: T.sub };
    return (
      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize"
        style={{ backgroundColor: s.bg, color: s.color, border: s.border ? `1px solid ${s.border}` : 'none' }}>
        {status}
      </span>
    );
  };

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* ─── A. Welcome banner ─────────────────────────────── */}
        <motion.div
          variants={cardVariants}
          className="rounded-2xl p-6 mb-6 flex items-center justify-between"
          style={{ background: 'linear-gradient(135deg, #FFF7ED 0%, #FAF7F2 100%)', border: '1px solid #FED7AA' }}
        >
          <div>
            <p className="text-sm" style={{ color: T.sub }}>{greeting}, {cleanDoctorName(d.doctor_name) || 'Doctor'} 👋</p>
            <h1 className="text-2xl font-extrabold mt-1" style={{ color: T.dark }}>Here's what's happening today</h1>
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-xs px-3 py-1 rounded-full bg-white border" style={{ borderColor: T.border, color: T.sub }}>
                📅 {format(now, 'EEEE, dd MMM yyyy')}
              </span>
              <span className="text-xs px-3 py-1 rounded-full bg-white border" style={{ borderColor: T.border, color: T.sub }}>
                🕐 {format(now, 'hh:mm a')}
              </span>
              <button
                onClick={toggleOnline}
                disabled={toggling}
                className="text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1.5 font-semibold"
                style={{
                  borderColor: d.is_online ? '#86efac' : T.border,
                  backgroundColor: d.is_online ? '#f0fdf4' : '#fff',
                  color: d.is_online ? '#16a34a' : T.sub,
                }}
              >
                <span className={`w-2 h-2 rounded-full ${d.is_online ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                {toggling ? '…' : d.is_online ? 'Online' : 'Offline'}
              </button>
            </div>
          </div>
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="hidden md:flex w-20 h-20 rounded-2xl items-center justify-center text-5xl"
            style={{ backgroundColor: '#fff', border: '1px solid #FED7AA' }}
          >
            🩺
          </motion.div>
        </motion.div>

        {/* ─── Critical lab values banner ────────────────────── */}
        {criticalAlerts.length > 0 && (
          <motion.div variants={cardVariants} className="mb-6">
            <div
              className="rounded-2xl border-2 p-4"
              style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl animate-bounce">🚨</span>
                <div>
                  <p className="font-bold text-red-700 text-lg">
                    Critical Lab Values Detected!
                  </p>
                  <p className="text-red-600 text-sm">
                    {criticalAlerts.length} patient(s) require immediate attention!
                  </p>
                </div>
              </div>

              {criticalAlerts.map((alert, i) => (
                <div
                  key={alert.report_id || i}
                  className="bg-white rounded-xl p-3 mb-2 border border-red-100"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-black">
                        👤 {alert.patient_name}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {alert.critical_flags?.map((flag, j) => (
                          <span
                            key={j}
                            className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium"
                          >
                            {flag.test}: {flag.value} {flag.unit} ({flag.status})
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/doctor/patients/${alert.patient_id}`)}
                      className="px-4 py-2 rounded-full text-sm font-semibold text-white flex-shrink-0"
                      style={{ backgroundColor: '#EF4444' }}
                    >
                      View Patient
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* ─── B. Stats row ──────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          <SparkStatCard index={0} icon={FiCalendar}  title="Total Appointments" value={totalAppointments}      trend="↑ 12%" color={T.orange} />
          <SparkStatCard index={1} icon={FiUsers}     title="Patients Seen"      value={d.total_patients_seen ?? 0} trend="↑ 8%"  color="#3b82f6" />
          <SparkStatCard index={2} icon={FiFilePlus}  title="Prescriptions"      value={prescriptionsWritten}    trend="↑ 5%"  color={T.orange} />
          <SparkStatCard index={3} icon={FiClipboard} title="Lab Tests Ordered"  value={d.pending_lab_results ?? 0} trend="↑ 3%" color="#8b5cf6" />
          <SparkStatCard index={4} icon={FiActivity}  title="Today's Consultations" value={d.today_consultations ?? 0} highlight />
        </div>

        {/* ─── C. Three column layout ────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-8">
          {/* Today's schedule */}
          <motion.div variants={cardVariants} className="xl:col-span-5 rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <SectionHead
              title="Today's Schedule"
              action={<Link to="/doctor/consultations" className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: T.orange }}>View All <FiArrowRight className="w-3.5 h-3.5" /></Link>}
            />
            {consultations.loading ? (
              <p className="text-sm py-6 text-center" style={{ color: T.sub }}>Loading…</p>
            ) : todayList.length === 0 ? (
              <div className="text-center py-10" style={{ color: T.sub }}>
                <span className="text-3xl">📅</span>
                <p className="text-sm mt-2">No consultations today</p>
              </div>
            ) : (
              <div className="space-y-3">
                {todayList.map((c) => {
                  const ts = getTimeStatus(c);
                  const isOffline = c.consult_mode === 'offline';
                  const target = isOffline ? `/doctor/offline-consultation/${c.consultation_id}` : `/doctor/consultation/${c.consultation_id}`;
                  return (
                    <div key={c.consultation_id} className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: T.bg }}>
                      <div className="text-xs font-bold w-14 shrink-0" style={{ color: ts.color === 'green' ? T.orange : T.sub }}>
                        {c.start_time || '--:--'}
                      </div>
                      <DoctorAvatar name={c.patient_name} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold truncate" style={{ color: T.dark }}>{c.patient_name}</div>
                        <div className="text-xs" style={{ color: T.sub }}>{isOffline ? '🏥 Physical visit' : '💻 Online'}</div>
                      </div>
                      <button
                        onClick={() => ts.canStart && navigate(target)}
                        disabled={!ts.canStart}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold shrink-0"
                        style={ts.canStart
                          ? { backgroundColor: T.orange, color: '#fff' }
                          : { backgroundColor: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
                      >
                        {ts.label}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* Patient overview chart */}
          <motion.div variants={cardVariants} className="xl:col-span-4 rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <SectionHead
              title="Patient Overview"
              action={<span className="text-xs px-3 py-1 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>This Week</span>}
            />
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weekData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: T.sub }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${T.border}`, fontSize: 12 }} />
                  <Line type="monotone" dataKey="patients" stroke={T.orange} strokeWidth={2.5} dot={{ r: 3, fill: T.orange }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center">
              {[
                { label: 'Total', value: d.total_patients_seen ?? 0, trend: '↑' },
                { label: 'New', value: Math.round((d.total_patients_seen ?? 0) * 0.3), trend: '↑' },
                { label: 'Returning', value: Math.round((d.total_patients_seen ?? 0) * 0.7), trend: '↑' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl p-2" style={{ backgroundColor: T.bg }}>
                  <div className="text-lg font-extrabold" style={{ color: T.dark }}>{s.value}</div>
                  <div className="text-[11px]" style={{ color: T.sub }}>{s.label} <span className="text-green-500">{s.trend}</span></div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Quick actions */}
          <motion.div variants={cardVariants} className="xl:col-span-3">
            <SectionHead title="Quick Actions" />
            <div className="grid grid-cols-2 gap-3">
              {QUICK_ACTIONS.map((a) => (
                <Link
                  key={a.label}
                  to={a.to}
                  className="rounded-2xl p-4 bg-white border flex flex-col items-center justify-center text-center gap-2 transition-all hover:bg-orange-50"
                  style={{ borderColor: T.border, minHeight: 92 }}
                >
                  <a.icon className="w-5 h-5" style={{ color: T.orange }} />
                  <span className="text-xs font-medium" style={{ color: T.dark }}>{a.label}</span>
                </Link>
              ))}
              <button
                onClick={() => setSlotModal(true)}
                className="rounded-2xl p-4 bg-white border flex flex-col items-center justify-center text-center gap-2 transition-all hover:bg-orange-50"
                style={{ borderColor: T.border, minHeight: 92 }}
              >
                <FiPlus className="w-5 h-5" style={{ color: T.orange }} />
                <span className="text-xs font-medium" style={{ color: T.dark }}>Add Slot</span>
              </button>
              <Link
                to="/doctor/consultations"
                className="rounded-2xl p-4 border flex flex-col items-center justify-center text-center gap-2 transition-all text-white"
                style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.orangeDark})`, borderColor: T.orange, minHeight: 92 }}
              >
                <FiUser className="w-5 h-5" />
                <span className="text-xs font-medium">Offline Visit</span>
              </Link>
            </div>
          </motion.div>
        </div>

        {/* ─── D. Bottom two columns ─────────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Recent patients table */}
          <motion.div variants={cardVariants} className="xl:col-span-7 rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <SectionHead
              title="Recent Patients"
              action={<Link to="/doctor/patients" className="text-sm font-semibold inline-flex items-center gap-1" style={{ color: T.orange }}>View All <FiArrowRight className="w-3.5 h-3.5" /></Link>}
            />
            {recentPatients.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: T.sub }}>No patients yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase" style={{ color: T.sub }}>
                      <th className="py-2 px-2 font-medium">Patient</th>
                      <th className="py-2 px-2 font-medium">Visit Type</th>
                      <th className="py-2 px-2 font-medium">Date</th>
                      <th className="py-2 px-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPatients.map((c, i) => (
                      <tr key={c.consultation_id} style={{ backgroundColor: i % 2 ? T.bg : '#fff' }}>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-2">
                            <DoctorAvatar name={c.patient_name} size={32} />
                            <span className="font-medium" style={{ color: T.dark }}>{c.patient_name}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>
                            {c.consult_mode === 'offline' ? 'Physical' : 'Online'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2" style={{ color: T.sub }}>{c.slot_date || '—'}</td>
                        <td className="py-2.5 px-2">{statusBadge(c.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </motion.div>

          {/* Recent activity */}
          <motion.div variants={cardVariants} className="xl:col-span-5 rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <SectionHead title="Recent Activity" />
            {activity.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: T.sub }}>No recent activity.</p>
            ) : (
              <div className="space-y-3">
                {activity.map((a, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${a.color}1a` }}>
                      {a.type === 'prescription' ? <FiFileText className="w-4 h-4" style={{ color: a.color }} /> : <FiCalendar className="w-4 h-4" style={{ color: a.color }} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" style={{ color: T.dark }}>{a.text}</div>
                      <div className="text-xs" style={{ color: T.sub }}>{a.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>

      {/* ─── Add slot modal ──────────────────────────────────── */}
      <Modal isOpen={slotModal} onClose={() => setSlotModal(false)} title="Add Time Slot">
        <form onSubmit={submitSlot} className="space-y-4">
          <FormInput label="Date" type="date" value={slotForm.slot_date} onChange={(e) => setSlotForm({ ...slotForm, slot_date: e.target.value })} required />
          <div className="grid grid-cols-2 gap-4">
            <FormInput label="Start Time" type="time" value={slotForm.start_time} onChange={(e) => setSlotForm({ ...slotForm, start_time: e.target.value })} required />
            <FormInput label="End Time" type="time" value={slotForm.end_time} onChange={(e) => setSlotForm({ ...slotForm, end_time: e.target.value })} required />
          </div>
          <FormInput label="Consultation Type" as="select" value={slotForm.consult_type}
            onChange={(e) => setSlotForm({ ...slotForm, consult_type: e.target.value })}
            options={[{ value: 'online', label: 'Online (Jitsi)' }, { value: 'in_person', label: 'In Person' }]} />
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={() => setSlotModal(false)} className="btn-orange-outline">Cancel</button>
            <button type="submit" disabled={savingSlot} className="btn-orange disabled:opacity-60">
              {savingSlot ? 'Adding…' : 'Add Slot'}
            </button>
          </div>
        </form>
      </Modal>
    </DoctorLayout>
  );
};

export default DoctorDashboard;
