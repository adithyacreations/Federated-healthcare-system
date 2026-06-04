import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import { FiPlus, FiClock, FiChevronLeft, FiChevronRight } from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { T } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const ManageSlots = () => {
  const slots = useApi('/api/doctor/slots/');
  const [form, setForm] = useState({ slot_date: '', start_time: '', end_time: '', consult_type: 'online' });
  const [submitting, setSubmitting] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDate, setSelectedDate] = useState(iso(new Date()));

  const today = iso(new Date());

  const slotsByDate = useMemo(() => {
    const out = {};
    (slots.data || []).forEach((s) => { (out[s.slot_date] = out[s.slot_date] || []).push(s); });
    Object.values(out).forEach((arr) => arr.sort((a, b) => a.start_time.localeCompare(b.start_time)));
    return out;
  }, [slots.data]);

  const existingSlotsForDate = useMemo(
    () => (slots.data || []).filter((s) => s.slot_date === form.slot_date),
    [slots.data, form.slot_date],
  );

  const selectedSlots = slotsByDate[selectedDate] || [];

  // Calendar grid for the viewed month.
  const calendarCells = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(iso(new Date(year, month, day)));
    return cells;
  }, [viewMonth]);

  // Duration of the slot being created, in minutes (0 until both times set).
  const getDuration = () => {
    if (!form.start_time || !form.end_time) return 0;
    const [sh, sm] = form.start_time.split(':').map(Number);
    const [eh, em] = form.end_time.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  };

  // Mirror the backend rules so the doctor gets instant feedback.
  const validateSlot = () => {
    if (!form.slot_date || !form.start_time || !form.end_time) {
      toast.error('Please fill date, start time and end time.');
      return false;
    }
    if (form.slot_date < today) {
      toast.error('Cannot create slot for past date!');
      return false;
    }
    if (form.slot_date === today) {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startH, startM] = form.start_time.split(':').map(Number);
      if (startH * 60 + startM <= currentMinutes) {
        toast.error(
          `Cannot create slot for past time! Current time: ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`,
        );
        return false;
      }
    }
    const duration = getDuration();
    if (duration <= 0) {
      toast.error('End time must be after start time!');
      return false;
    }
    if (duration > 120) {
      toast.error(`Slot duration cannot exceed 2 hours! Current: ${duration} minutes`);
      return false;
    }
    if (duration < 15) {
      toast.error('Slot must be at least 15 minutes!');
      return false;
    }
    return true;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!validateSlot()) return;
    setSubmitting(true);
    try {
      await API.post('/api/doctor/slots/create/', form);
      toast.success('Slot created');
      setForm({ slot_date: '', start_time: '', end_time: '', consult_type: 'online' });
      slots.refetch();
    } catch (err) {
      const data = err?.response?.data;
      const msg = data?.errors ? Object.values(data.errors).flat().join(' · ') : data?.message || 'Could not create slot';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const safeDate = (s) => { try { return format(parseISO(s), 'EEE, dd MMM yyyy'); } catch { return s; } };

  const shiftMonth = (delta) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>Manage Slots</h1>
            <p className="text-sm" style={{ color: T.sub }}>Add availability so patients can book appointments.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ─── Calendar ─────────────────────────────────────── */}
          <motion.div variants={cardVariants} className="rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => shiftMonth(-1)} className="p-2 rounded-full hover:bg-orange-50"><FiChevronLeft style={{ color: T.dark }} /></button>
              <h3 className="font-bold" style={{ color: T.dark }}>{format(viewMonth, 'MMMM yyyy')}</h3>
              <button onClick={() => shiftMonth(1)} className="p-2 rounded-full hover:bg-orange-50"><FiChevronRight style={{ color: T.dark }} /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {WEEKDAYS.map((w, i) => (<div key={i} className="text-[11px] font-semibold" style={{ color: T.sub }}>{w}</div>))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((date, i) => {
                if (!date) return <div key={i} />;
                const day = Number(date.slice(-2));
                const hasSlots = !!slotsByDate[date];
                const isSel = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    onClick={() => { setSelectedDate(date); setForm((f) => ({ ...f, slot_date: date })); }}
                    className="relative aspect-square rounded-lg text-sm flex items-center justify-center transition"
                    style={{
                      backgroundColor: isSel ? T.orange : isToday ? T.tint : 'transparent',
                      color: isSel ? '#fff' : T.dark,
                      fontWeight: isToday || isSel ? 700 : 400,
                    }}
                  >
                    {day}
                    {hasSlots && !isSel && (
                      <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: T.orange }} />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Slots for selected date */}
            <div className="mt-5 pt-4 border-t" style={{ borderColor: '#f3f4f6' }}>
              <p className="text-sm font-semibold mb-2" style={{ color: T.dark }}>{safeDate(selectedDate)}</p>
              {selectedSlots.length === 0 ? (
                <p className="text-sm" style={{ color: T.sub }}>No slots on this date.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {selectedSlots.map((s) => (
                    <div key={s.slot_id} className="p-2.5 rounded-xl border" style={{ borderColor: s.is_booked ? '#fecaca' : '#bbf7d0', backgroundColor: s.is_booked ? '#fef2f2' : '#f0fdf4' }}>
                      <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: s.is_booked ? '#b91c1c' : '#15803d' }}>
                        <FiClock className="w-3.5 h-3.5" /> {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: T.sub }}>
                        {s.consult_type} · {s.is_booked ? 'Booked' : 'Available'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>

          {/* ─── Add slot form ────────────────────────────────── */}
          <motion.div variants={cardVariants} className="rounded-2xl p-5 bg-white border h-fit" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 mb-4">
              <FiPlus style={{ color: T.orange }} />
              <h2 className="font-bold" style={{ color: T.dark }}>Add Slot</h2>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: T.sub }}>Date</label>
                <input type="date" value={form.slot_date} onChange={(e) => { setForm({ ...form, slot_date: e.target.value }); if (e.target.value) setSelectedDate(e.target.value); }} required
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400" style={{ borderColor: T.border }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: T.sub }}>Start time</label>
                  <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} required
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400" style={{ borderColor: T.border }} />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: T.sub }}>End time</label>
                  <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} required
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400" style={{ borderColor: T.border }} />
                </div>
              </div>

              {form.start_time && form.end_time && (() => {
                const duration = getDuration();
                const valid = duration >= 15 && duration <= 120;
                const tooLong = duration > 120;
                return (
                  <div
                    className="rounded-xl p-3 text-sm font-medium"
                    style={valid
                      ? { backgroundColor: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }
                      : tooLong
                        ? { backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }
                        : { backgroundColor: '#fff7ed', color: '#F97316', border: '1px solid #FED7AA' }}
                  >
                    ⏱️ Duration: {duration} minutes
                    {tooLong && ' — Exceeds 2 hour limit!'}
                    {duration < 15 && ' — Minimum 15 minutes required!'}
                    {valid && ' ✓ Valid'}
                  </div>
                );
              })()}

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: T.sub }}>Type</label>
                <div className="flex gap-2">
                  {[{ v: 'online', l: 'Online' }, { v: 'in_person', l: 'Offline' }].map((opt) => (
                    <button key={opt.v} type="button" onClick={() => setForm({ ...form, consult_type: opt.v })}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold border transition"
                      style={form.consult_type === opt.v ? { backgroundColor: T.orange, color: '#fff', borderColor: T.orange } : { backgroundColor: '#fff', color: T.sub, borderColor: T.border }}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>

              {form.slot_date && existingSlotsForDate.length > 0 && (
                <div className="rounded-xl p-3" style={{ backgroundColor: '#fffbeb', border: '1px solid #fde68a' }}>
                  <p className="text-xs font-semibold mb-2" style={{ color: '#a16207' }}>⚠️ Occupied times on {form.slot_date}:</p>
                  <div className="flex flex-wrap gap-2">
                    {existingSlotsForDate.map((s) => (
                      <span key={s.slot_id} className="text-xs px-3 py-1 rounded-full font-medium" style={{ backgroundColor: '#fef3c7', color: '#92400e' }}>
                        🔒 {s.start_time?.slice(0, 5)}–{s.end_time?.slice(0, 5)}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs mt-2" style={{ color: '#a16207' }}>New slot must not overlap the occupied times above.</p>
                </div>
              )}

              <button type="submit" disabled={submitting} className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-60" style={{ backgroundColor: T.orange }}>
                {submitting ? 'Adding…' : 'Add Slot'}
              </button>
            </form>
          </motion.div>
        </div>
      </motion.div>
    </DoctorLayout>
  );
};

export default ManageSlots;
