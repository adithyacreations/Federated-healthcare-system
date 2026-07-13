import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  FiCalendar, FiClock, FiEdit2, FiLock, FiRefreshCcw, FiSave, FiTrash2, FiX,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import API from '../../api/axios';
import { cleanDoctorName } from '../../utils/nameUtils';

const DAYS = [
  { key: 'monday', label: 'Mon' },
  { key: 'tuesday', label: 'Tue' },
  { key: 'wednesday', label: 'Wed' },
  { key: 'thursday', label: 'Thu' },
  { key: 'friday', label: 'Fri' },
  { key: 'saturday', label: 'Sat' },
  { key: 'sunday', label: 'Sun' },
];

const BLANK_FORM = {
  doctor_id: '',
  working_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
  start_time: '09:00',
  end_time: '17:00',
  slot_duration_minutes: 30,
  consultation_type: 'both',
  consultation_fee: '500',
  is_active: true,
  days_ahead: 30,
};

const STATUS_STYLE = {
  available: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  booked: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
  in_progress: { bg: '#fef2f2', border: '#fecaca', text: '#dc2626' },
  completed: { bg: '#f3f4f6', border: '#d1d5db', text: '#6b7280' },
  past: { bg: '#f9fafb', border: '#e5e7eb', text: '#9ca3af' },
  blocked: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
};

const todayISO = () => new Date().toISOString().split('T')[0];

const typeLabel = (value) => {
  if (value === 'both') return 'Online or offline';
  if (value === 'offline' || value === 'in_person') return 'Offline';
  return 'Online';
};

const DoctorSchedulePage = () => {
  const [dailySchedule, setDailySchedule] = useState([]);
  const [summary, setSummary] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedDoctor, setExpandedDoctor] = useState(null);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [form, setForm] = useState(BLANK_FORM);
  const [blockSlot, setBlockSlot] = useState(null);
  const [blockReason, setBlockReason] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [deletingSchedule, setDeletingSchedule] = useState(null);

  const approvedDoctors = useMemo(
    () => doctors.filter((d) => d.approval_status === 'approved' && d.is_active !== false),
    [doctors],
  );

  const visibleSchedules = useMemo(() => {
    const seen = new Set();
    return schedules.filter((schedule) => {
      const doctorId = String(schedule.doctor || '');
      if (seen.has(doctorId)) return false;
      seen.add(doctorId);
      return true;
    });
  }, [schedules]);

  const scheduledDoctorIds = useMemo(
    () => new Set(visibleSchedules.map((schedule) => String(schedule.doctor))),
    [visibleSchedules],
  );

  const fetchBoard = async () => {
    const res = await API.get(`/api/hospital/doctor-schedule/?date=${selectedDate}`);
    if (res.data?.success) {
      setDailySchedule(res.data.data || []);
      setSummary(res.data.summary || null);
    }
  };

  const fetchSchedules = async () => {
    const res = await API.get('/api/hospital/doctor-schedules/');
    if (res.data?.success) setSchedules(res.data.data?.schedules || []);
  };

  const fetchDoctors = async () => {
    const res = await API.get('/api/hospital/doctors/');
    if (res.data?.success) setDoctors(res.data.data || []);
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      await Promise.all([fetchBoard(), fetchSchedules(), fetchDoctors()]);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not load schedule data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  const toggleDay = (day) => {
    setForm((current) => {
      const set = new Set(current.working_days);
      if (set.has(day)) set.delete(day);
      else set.add(day);
      return { ...current, working_days: DAYS.map((d) => d.key).filter((key) => set.has(key)) };
    });
  };

  const resetForm = () => {
    setEditingSchedule(null);
    setForm(BLANK_FORM);
  };

  const editSchedule = (schedule) => {
    setEditingSchedule(schedule);
    setForm({
      doctor_id: schedule.doctor,
      working_days: schedule.working_days || [],
      start_time: String(schedule.start_time || '09:00').slice(0, 5),
      end_time: String(schedule.end_time || '17:00').slice(0, 5),
      slot_duration_minutes: schedule.slot_duration_minutes,
      consultation_type: schedule.consultation_type,
      consultation_fee: String(schedule.consultation_fee ?? ''),
      is_active: schedule.is_active,
      days_ahead: 30,
    });
  };

  const submitSchedule = async (e) => {
    e.preventDefault();
    if (!form.doctor_id) return toast.error('Select a doctor');
    if (!editingSchedule && scheduledDoctorIds.has(String(form.doctor_id))) {
      return toast.error('This doctor already has a schedule. Click Edit to change it.');
    }
    if (!form.working_days.length) return toast.error('Working days cannot be empty');
    setSaving(true);
    try {
      const payload = {
        ...form,
        slot_duration_minutes: Number(form.slot_duration_minutes),
        consultation_fee: Number(form.consultation_fee || 0),
        days_ahead: Number(form.days_ahead || 30),
      };
      const response = editingSchedule
        ? await API.put(`/api/hospital/doctor-schedules/${editingSchedule.schedule_id}/`, payload)
        : await API.post('/api/hospital/doctor-schedules/', payload);
      toast.success(response.data?.message || 'Doctor schedule created successfully');
      if (response.data?.data?.slot_message) toast.success(response.data.data.slot_message);
      resetForm();
      await Promise.all([fetchBoard(), fetchSchedules()]);
    } catch (err) {
      const data = err?.response?.data;
      const errors = data?.errors && typeof data.errors === 'object'
        ? Object.values(data.errors).flat().join(' ')
        : '';
      toast.error(errors || data?.message || 'Could not save schedule');
    } finally {
      setSaving(false);
    }
  };

  const toggleScheduleActive = async (schedule) => {
    try {
      const payload = {
        doctor_id: schedule.doctor,
        working_days: schedule.working_days,
        start_time: String(schedule.start_time).slice(0, 5),
        end_time: String(schedule.end_time).slice(0, 5),
        slot_duration_minutes: schedule.slot_duration_minutes,
        consultation_type: schedule.consultation_type,
        consultation_fee: schedule.consultation_fee,
        is_active: !schedule.is_active,
        days_ahead: 30,
      };
      const response = await API.put(`/api/hospital/doctor-schedules/${schedule.schedule_id}/`, payload);
      toast.success(response.data?.message || 'Doctor schedule updated successfully');
      await Promise.all([fetchBoard(), fetchSchedules()]);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not update schedule');
    }
  };

  const deleteSchedule = async (schedule) => {
    const okToDelete = window.confirm(
      `Delete schedule for ${cleanDoctorName(schedule.doctor_name)}? Booked consultation history will be preserved.`,
    );
    if (!okToDelete) return;

    setDeletingSchedule(schedule.schedule_id);
    try {
      const response = await API.delete(`/api/hospital/doctor-schedules/${schedule.schedule_id}/`);
      toast.success(response.data?.message || 'Doctor schedule deleted successfully');
      if (editingSchedule?.schedule_id === schedule.schedule_id) resetForm();
      await Promise.all([fetchBoard(), fetchSchedules()]);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not delete schedule');
    } finally {
      setDeletingSchedule(null);
    }
  };

  const submitBlock = async (e) => {
    e.preventDefault();
    if (!blockSlot) return;
    setBlocking(true);
    try {
      await API.post(`/api/hospital/doctor-slots/${blockSlot.slot_id}/block/`, {
        block_reason: blockReason,
      });
      toast.success('Slot blocked successfully');
      setBlockSlot(null);
      setBlockReason('');
      await fetchBoard();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not block slot');
    } finally {
      setBlocking(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#fff6ec' }}>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-bricolage text-3xl font-extrabold text-black">Doctor Schedule Management</h1>
            <p className="text-gray-500 text-sm mt-1">
              Create hospital-controlled schedules, generate slots, and manage slot blocks.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-orange-400 bg-white"
            />
            <button
              onClick={() => setSelectedDate(todayISO())}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: '#ff4f01' }}
            >
              <FiCalendar className="w-4 h-4" /> Today
            </button>
            <button
              onClick={loadAll}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-black text-white"
            >
              <FiRefreshCcw className="w-4 h-4" /> Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
          <motion.form
            onSubmit={submitSchedule}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="xl:col-span-1 bg-white rounded-2xl border border-gray-200 p-5 h-fit"
          >
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="font-bold text-black">{editingSchedule ? 'Edit Schedule' : 'Create Schedule'}</h2>
              {editingSchedule && (
                <button type="button" onClick={resetForm} className="p-2 rounded-full hover:bg-orange-50" aria-label="Cancel edit">
                  <FiX className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Doctor</label>
                <select
                  value={form.doctor_id}
                  onChange={(e) => setForm({ ...form, doctor_id: e.target.value })}
                  disabled={Boolean(editingSchedule)}
                  className={`w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 ${
                    editingSchedule ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white'
                  }`}
                  required
                >
                  <option value="">Select doctor</option>
                  {approvedDoctors.map((doctor) => {
                    const alreadyScheduled = !editingSchedule && scheduledDoctorIds.has(String(doctor.doctor_id));
                    return (
                      <option key={doctor.doctor_id} value={doctor.doctor_id} disabled={alreadyScheduled}>
                        {cleanDoctorName(doctor.full_name)} - {doctor.specialization}
                        {alreadyScheduled ? ' (scheduled)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-2">Working Days</label>
                <div className="grid grid-cols-7 gap-1">
                  {DAYS.map((day) => {
                    const active = form.working_days.includes(day.key);
                    return (
                      <button
                        key={day.key}
                        type="button"
                        onClick={() => toggleDay(day.key)}
                        className="h-10 rounded-full text-xs font-semibold border cursor-pointer"
                        style={{
                          backgroundColor: active ? '#ff4f01' : '#fff',
                          color: active ? '#000' : '#666',
                          borderColor: active ? '#ff4f01' : '#e5e5e5',
                        }}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">End Time</label>
                  <input
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Slot Duration</label>
                  <input
                    type="number"
                    min="1"
                    value={form.slot_duration_minutes}
                    onChange={(e) => setForm({ ...form, slot_duration_minutes: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Fee</label>
                  <input
                    type="number"
                    min="0"
                    value={form.consultation_fee}
                    onChange={(e) => setForm({ ...form, consultation_fee: e.target.value })}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Consultation Type</label>
                <select
                  value={form.consultation_type}
                  onChange={(e) => setForm({ ...form, consultation_type: e.target.value })}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                >
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="both">Both</option>
                </select>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2.5 cursor-pointer">
                <span className="text-sm font-medium text-gray-700">Active schedule</span>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="h-4 w-4 accent-orange-500"
                />
              </label>

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 font-semibold disabled:opacity-60"
                style={{ backgroundColor: '#ff4f01', color: '#000' }}
              >
                <FiSave className="w-4 h-4" /> {saving ? 'Saving...' : editingSchedule ? 'Update Schedule' : 'Create Schedule'}
              </button>
            </div>
          </motion.form>

          <div className="xl:col-span-2 space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5">
              <h2 className="font-bold text-black mb-4">Saved Schedules</h2>
              {visibleSchedules.length === 0 ? (
                <p className="text-sm text-gray-500">No doctor schedules created yet.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {visibleSchedules.map((schedule) => (
                    <div key={schedule.schedule_id} className="rounded-xl border border-gray-200 p-4 bg-[#fffaf5]">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold text-black">{cleanDoctorName(schedule.doctor_name)}</p>
                          <p className="text-xs text-gray-500">{schedule.specialization || 'General'}</p>
                        </div>
                        <span
                          className="text-xs px-2.5 py-1 rounded-full font-semibold"
                          style={{
                            backgroundColor: schedule.is_active ? '#f0fdf4' : '#f3f4f6',
                            color: schedule.is_active ? '#15803d' : '#6b7280',
                          }}
                        >
                          {schedule.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                        <div className="flex items-center gap-2 text-gray-700">
                          <FiClock className="w-4 h-4 text-orange-500" />
                          {String(schedule.start_time).slice(0, 5)}-{String(schedule.end_time).slice(0, 5)}
                        </div>
                        <div className="text-gray-700">{schedule.slot_duration_minutes} min slots</div>
                        <div className="text-gray-700">₹{Number(schedule.consultation_fee || 0).toFixed(0)}</div>
                        <div className="text-gray-700">{typeLabel(schedule.consultation_type)}</div>
                      </div>
                      <p className="text-xs text-gray-500 mt-3 capitalize">{(schedule.working_days || []).join(', ')}</p>
                      <div className="flex gap-2 mt-4">
                        <button
                          onClick={() => editSchedule(schedule)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-black"
                        >
                          <FiEdit2 className="w-3.5 h-3.5" /> Edit
                        </button>
                        <button
                          onClick={() => toggleScheduleActive(schedule)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold border border-gray-200 bg-white"
                        >
                          {schedule.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          onClick={() => deleteSchedule(schedule)}
                          disabled={deletingSchedule === schedule.schedule_id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <FiTrash2 className="w-3.5 h-3.5" />
                          {deletingSchedule === schedule.schedule_id ? 'Deleting...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  ['Doctors', summary.total_doctors],
                  ['In Consultation', summary.in_consultation],
                  ['Available', summary.has_slots],
                  ['No Schedule', summary.no_slots],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white rounded-2xl border border-gray-200 p-4">
                    <p className="text-2xl font-extrabold text-black">{value}</p>
                    <p className="text-xs text-gray-500 mt-1">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-sm text-gray-500">Loading schedule...</div>
          ) : dailySchedule.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500">No doctors found.</div>
          ) : (
            dailySchedule.map((doctor) => {
              const isExpanded = expandedDoctor === doctor.doctor_id;
              return (
                <motion.div
                  key={doctor.doctor_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white rounded-2xl border border-gray-200 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedDoctor(isExpanded ? null : doctor.doctor_id)}
                    className="w-full p-4 flex items-center justify-between hover:bg-orange-50 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-full flex items-center justify-center text-black font-bold text-lg bg-orange-500/20 flex-shrink-0">
                        {doctor.full_name?.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-black truncate">{cleanDoctorName(doctor.full_name)}</p>
                        <p className="text-sm text-gray-500 truncate">{doctor.specialization || 'General'}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {doctor.total_slots} total · {doctor.booked_slots} booked · {doctor.blocked_slots || 0} blocked
                        </p>
                      </div>
                    </div>
                    <span className="text-xs px-3 py-1 rounded-full bg-orange-50 text-orange-600 font-semibold capitalize">
                      {String(doctor.availability || '').replaceAll('_', ' ')}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100">
                      {doctor.slots.length === 0 ? (
                        <p className="text-center text-gray-400 text-sm py-4">No slots generated for this date.</p>
                      ) : (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {doctor.slots.map((slot) => {
                            const style = STATUS_STYLE[slot.status] || STATUS_STYLE.available;
                            const canBlock = slot.status === 'available' && !slot.is_booked && !slot.is_blocked;
                            const blockedByLabel = slot.blocked_by === 'doctor'
                              ? 'Doctor'
                              : slot.blocked_by === 'hospital_admin'
                                ? 'Hospital admin'
                                : 'System';
                            return (
                              <div
                                key={slot.slot_id}
                                className="min-w-[180px] rounded-xl border p-3 text-xs"
                                style={{ backgroundColor: style.bg, borderColor: style.border, color: style.text }}
                              >
                                <p className="font-semibold text-sm">
                                  {String(slot.start_time).slice(0, 5)}-{String(slot.end_time).slice(0, 5)}
                                </p>
                                <p className="capitalize mt-1">{String(slot.status).replaceAll('_', ' ')}</p>
                                <p className="mt-1 text-gray-500">{typeLabel(slot.consult_type)} · ₹{Number(slot.consultation_fee || 0).toFixed(0)}</p>
                                {slot.patient_name && <p className="truncate mt-1 text-gray-600">{slot.patient_name}</p>}
                                {slot.status === 'blocked' && (
                                  <div className="mt-2 rounded-lg bg-white/70 border border-red-100 px-2 py-1.5 text-[11px] text-red-700">
                                    <p>Blocked by: {blockedByLabel}</p>
                                    <p>Reason: {slot.block_reason || 'Unavailable'}</p>
                                  </div>
                                )}
                                {canBlock && (
                                  <button
                                    onClick={() => { setBlockSlot(slot); setBlockReason(''); }}
                                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white bg-black cursor-pointer"
                                  >
                                    <FiLock className="w-3.5 h-3.5" /> Block
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      <Modal isOpen={Boolean(blockSlot)} onClose={() => setBlockSlot(null)} title="Block Doctor Slot">
        <form onSubmit={submitBlock} className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-orange-50 p-3">
            <p className="font-semibold text-black">
              {blockSlot?.start_time?.slice(0, 5)}-{blockSlot?.end_time?.slice(0, 5)}
            </p>
            <p className="text-xs text-gray-500 mt-1">Booked slots cannot be blocked.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Reason</label>
            <textarea
              rows={3}
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
              placeholder="Doctor unavailable, emergency duty, maintenance..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setBlockSlot(null)} className="px-4 py-2 rounded-full border border-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={blocking} className="px-4 py-2 rounded-full bg-black text-white disabled:opacity-60">
              {blocking ? 'Blocking...' : 'Block Slot'}
            </button>
          </div>
        </form>
      </Modal>
    </DashboardLayout>
  );
};

export default DoctorSchedulePage;
