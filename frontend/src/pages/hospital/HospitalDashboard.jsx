import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiUsers, FiGrid, FiPackage, FiShoppingCart, FiCpu, FiHeart,
  FiCheckCircle, FiAlertOctagon, FiCalendar,
} from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import StatsCard from '../../components/dashboard/StatsCard';
import QuickActionCard from '../../components/dashboard/QuickActionCard';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { cleanDoctorName } from '../../utils/nameUtils';

const SCHEDULE_PILL = {
  has_slots:       { bg: '#F0FDF4', color: '#16A34A', label: 'Available' },
  in_consultation: { bg: '#FEF2F2', color: '#DC2626', label: 'In Consultation' },
  done_for_day:    { bg: '#F3F4F6', color: '#9CA3AF', label: 'Done' },
  no_slots:        { bg: '#F3F4F6', color: '#9CA3AF', label: 'No Schedule' },
};

const SCHEDULE_DOT = {
  has_slots: '#22C55E',
  in_consultation: '#EF4444',
  done_for_day: '#9CA3AF',
  no_slots: '#D1D5DB',
};

const HospitalDashboard = () => {
  const navigate = useNavigate();
  const stats = useApi('/api/hospital/dashboard/', { pollInterval: 30000 });
  const { data: incomingData, refetch: refetchIncoming } = useApi(
    '/api/emergency/incoming-patients/', { pollInterval: 15000 },
  );
  const incomingPatients = Array.isArray(incomingData) ? incomingData : [];
  const [acknowledging, setAcknowledging] = useState(null);
  const [markingReady, setMarkingReady] = useState(null);

  const [todaySchedule, setTodaySchedule] = useState([]);
  useEffect(() => {
    const fetchTodaySchedule = async () => {
      try {
        const today = new Date().toISOString().split('T')[0];
        const res = await API.get(`/api/hospital/doctor-schedule/?date=${today}`);
        if (res.data?.success) {
          setTodaySchedule((res.data.data || []).slice(0, 4));
        }
      } catch (e) {
        /* best-effort */
      }
    };
    fetchTodaySchedule();
    const id = setInterval(fetchTodaySchedule, 60000);
    return () => clearInterval(id);
  }, []);

  const markBedReady = async (dispatchId) => {
    setMarkingReady(dispatchId);
    try {
      const response = await API.post(`/api/emergency/dispatch/${dispatchId}/bed-ready/`);
      if (response.data?.success) {
        toast.success('🏥 Hospital marked ready! Driver notified.');
        // Refetch so the persisted bed_ready state is reflected immediately.
        refetchIncoming();
      }
    } catch {
      toast.error('Failed to mark ready');
    } finally {
      setMarkingReady(null);
    }
  };

  const acknowledgePatient = async (dispatchId) => {
    setAcknowledging(dispatchId);
    try {
      const response = await API.post(`/api/emergency/dispatch/${dispatchId}/acknowledge/`);
      if (response.data?.success) {
        toast.success('✅ Patient acknowledged! Ambulance freed.');
        refetchIncoming();
        stats.refetch?.();
      }
    } catch {
      toast.error('Failed to acknowledge');
    } finally {
      setAcknowledging(null);
    }
  };

  const d = stats.data || {};

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <DashboardHeader
          title={d.hospital_name || 'Hospital Admin'}
          subtitle={d.city || 'Hospital operations dashboard'}
        />

        {/* ─── Incoming patients (urgent) ────────────────────────── */}
        {incomingPatients.length > 0 && (
          <motion.div
            variants={cardVariants}
            className="bg-red-50 border-2 border-red-400 rounded-2xl p-4 mb-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">🚨</span>
              <h2 className="font-bricolage font-bold text-red-700 text-lg">Incoming Patients!</h2>
              <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full ml-auto font-bold">
                {incomingPatients.length}
              </span>
            </div>

            {incomingPatients.map((patient) => (
              <div key={patient.dispatch_id} className="bg-white rounded-xl p-3 mb-2 border border-red-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center font-bold shrink-0">
                        {(patient.patient_name || '?').charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-ink truncate">{patient.patient_name}</p>
                        {patient.patient_phone && (
                          <p className="text-xs text-muted">📞 {patient.patient_phone}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <span className={`text-xs px-2 py-1 rounded-full font-bold uppercase ${
                        patient.severity === 'critical'
                          ? 'bg-red-100 text-red-700'
                          : patient.severity === 'high'
                          ? 'bg-orange-100 text-orange-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        🚨 {patient.severity}
                      </span>
                      {patient.blood_group && (
                        <span className="text-xs px-2 py-1 rounded-full bg-red-50 text-red-600 font-medium">
                          🩸 {patient.blood_group}
                        </span>
                      )}
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                        🚑 {patient.vehicle_no || patient.ambulance_no}
                      </span>
                      <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                        👤 {patient.driver_name}
                      </span>
                      {patient.arrived_at && (
                        <span className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-600">
                          🕐 {(() => { try { return new Date(patient.arrived_at).toLocaleTimeString(); } catch { return '—'; } })()}
                        </span>
                      )}
                      {patient.reserved_bed && (
                        <span className="text-xs px-2 py-1 rounded-full bg-green-50 text-green-600">
                          🛏️ {patient.bed_ward || 'Bed'}{patient.bed_type ? ` · ${patient.bed_type}` : ''}
                        </span>
                      )}
                    </div>
                    {patient.bed_severity_label && (
                      <div
                        className={`rounded-xl p-2 mt-2 flex items-center gap-2 ${
                          patient.severity === 'critical'
                            ? 'bg-red-50 border border-red-200'
                            : patient.severity === 'high'
                            ? 'bg-orange-50 border border-orange-200'
                            : 'bg-green-50 border border-green-200'
                        }`}
                      >
                        <span className="text-lg">🛏️</span>
                        <div>
                          <p
                            className={`font-bold text-xs ${
                              patient.severity === 'critical'
                                ? 'text-red-700'
                                : patient.severity === 'high'
                                ? 'text-orange-700'
                                : 'text-green-700'
                            }`}
                          >
                            {patient.bed_severity_label}
                          </p>
                          <p className="text-xs text-gray-500">
                            Ward: {patient.bed_ward || 'N/A'} · Type: {patient.bed_type || 'N/A'}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col gap-2 w-40">
                    {patient.bed_ready ? (
                      <div className="py-2 rounded-full text-xs font-semibold text-center bg-green-100 text-green-700">
                        ✅ Hospital Ready!
                        {patient.bed_ready_at && (
                          <span className="text-xs block text-green-600">
                            {(() => { try { return new Date(patient.bed_ready_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } })()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => markBedReady(patient.dispatch_id)}
                        disabled={markingReady === patient.dispatch_id}
                        className="py-2 rounded-full text-xs font-semibold text-white disabled:opacity-50"
                        style={{ backgroundColor: '#000000' }}
                      >
                        {markingReady === patient.dispatch_id ? '⏳ Notifying…' : '🏥 Mark Bed Ready'}
                      </button>
                    )}

                    {patient.status === 'pending_acknowledgment' ? (
                      <button
                        onClick={() => acknowledgePatient(patient.dispatch_id)}
                        disabled={acknowledging === patient.dispatch_id}
                        className="py-2 rounded-full font-semibold text-white text-sm disabled:opacity-60"
                        style={{ backgroundColor: '#F97316' }}
                      >
                        {acknowledging === patient.dispatch_id ? '…' : 'Acknowledge'}
                      </button>
                    ) : (
                      <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">
                        <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                        En route
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* ─── Stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard
            icon={FiHeart}
            title="Active Patients"
            value={d.active_patients ?? 0}
            hint="Today's consultations + emergencies"
          />
          <StatsCard
            icon={FiUsers}
            title="Available Doctors"
            value={d.online_doctors ?? d.available_doctors ?? 0}
            hint={`of ${d.total_doctors ?? 0} total`}
          />
          <StatsCard
            icon={FiCalendar}
            title="Today's Consultations"
            value={d.todays_consultations ?? 0}
            hint={`📅 ${d.monthly_consultations ?? 0} this month`}
          />
          <StatsCard
            icon={FiCheckCircle}
            title="Available Beds"
            value={d.available_beds ?? 0}
            hint={`of ${d.total_beds ?? 0} total`}
          />
        </div>

        {/* ─── Today's doctor schedule preview ───────────────────── */}
        {todaySchedule.length > 0 && (
          <motion.div variants={cardVariants} className="bg-white rounded-2xl p-5 border border-gray-100 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">📅 Today's Doctor Schedule</h3>
              <button
                onClick={() => navigate('/hospital/schedule')}
                className="text-sm font-medium hover:underline"
                style={{ color: '#F97316' }}
              >
                View All →
              </button>
            </div>

            <div className="space-y-2">
              {todaySchedule.map((doctor) => {
                const pill = SCHEDULE_PILL[doctor.availability] || SCHEDULE_PILL.no_slots;
                const dot = SCHEDULE_DOT[doctor.availability] || '#D1D5DB';
                return (
                  <div
                    key={doctor.doctor_id}
                    className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
                      <div>
                        <p className="font-medium text-sm text-black">{cleanDoctorName(doctor.full_name)}</p>
                        <p className="text-xs text-gray-400">
                          {doctor.specialization || 'General'} · {doctor.total_slots} slots today
                        </p>
                      </div>
                    </div>
                    <span
                      className="text-xs font-medium px-2 py-1 rounded-full"
                      style={{ backgroundColor: pill.bg, color: pill.color }}
                    >
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* ─── Quick actions ─────────────────────────────────────── */}
        <section>
          <h2 className="dash-h2">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <QuickActionCard icon={FiUsers}        to="/hospital/staff"            title="Manage Staff"     description={`${d.total_doctors ?? '—'} doctors + lab + drivers`} />
            <QuickActionCard icon={FiGrid}         to="/hospital/beds"             title="View Beds"        description={`${d.available_beds ?? '—'} / ${d.total_beds ?? '—'} available`} />
            <QuickActionCard icon={FiPackage}      to="/hospital/inventory"        title="Check Inventory"  description={`${d.low_stock_items ?? 0} low-stock alerts`} />
            <QuickActionCard icon={FiShoppingCart} to="/hospital/equipment-orders" title="Equipment Orders" description="Procure from vendors" />
            <QuickActionCard icon={FiCpu}          to="/hospital/fl-client"        title="FL Client"        description="Submit local weights" />
            <QuickActionCard icon={FiHeart}        to="/hospital/patients"         title="Hospital Patients" description="View admitted patients" />
          </div>
        </section>
      </motion.div>
    </DashboardLayout>
  );
};

export default HospitalDashboard;
