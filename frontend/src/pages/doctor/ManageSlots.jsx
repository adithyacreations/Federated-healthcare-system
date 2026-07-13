import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiCalendar, FiChevronLeft, FiChevronRight, FiClock, FiLock, FiInfo,
} from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import Modal from '../../components/common/Modal';
import { T } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STATUS_STYLE = {
  available: { bg: '#f0fdf4', border: '#bbf7d0', text: '#15803d' },
  booked: { bg: '#fff7ed', border: '#fed7aa', text: '#c2410c' },
  blocked: { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' },
};

const typeLabel = (value) => {
  if (value === 'both') return 'Online or offline';
  if (value === 'offline' || value === 'in_person') return 'Offline';
  return 'Online';
};

const safeDate = (value) => {
  try { return format(parseISO(value), 'EEE, dd MMM yyyy'); } catch { return value; }
};

const ManageSlots = () => {
  const slots = useApi('/api/doctor/slots/');
  const schedules = useApi('/api/doctor/schedules/');
  const [viewMonth, setViewMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(iso(new Date()));
  const [blockSlot, setBlockSlot] = useState(null);
  const [blockReason, setBlockReason] = useState('');
  const [blocking, setBlocking] = useState(false);

  const today = iso(new Date());
  const slotList = useMemo(() => slots.data || [], [slots.data]);
  const scheduleList = schedules.data || [];

  const slotsByDate = useMemo(() => {
    const out = {};
    slotList.forEach((s) => {
      (out[s.slot_date] = out[s.slot_date] || []).push(s);
    });
    Object.values(out).forEach((arr) => arr.sort((a, b) => a.start_time.localeCompare(b.start_time)));
    return out;
  }, [slotList]);

  const selectedSlots = slotsByDate[selectedDate] || [];

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

  const counts = useMemo(() => ({
    available: slotList.filter((s) => s.status === 'available' && !s.is_blocked && !s.is_booked).length,
    booked: slotList.filter((s) => s.status === 'booked' || s.is_booked).length,
    blocked: slotList.filter((s) => s.status === 'blocked' || s.is_blocked).length,
  }), [slotList]);

  const shiftMonth = (delta) => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const submitBlock = async (e) => {
    e.preventDefault();
    if (!blockSlot) return;
    setBlocking(true);
    try {
      await API.post(`/api/doctor/slots/${blockSlot.slot_id}/block/`, {
        block_reason: blockReason,
      });
      toast.success('Slot blocked successfully');
      setBlockSlot(null);
      setBlockReason('');
      slots.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not block slot');
    } finally {
      setBlocking(false);
    }
  };

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>My Schedule</h1>
            <p className="text-sm" style={{ color: T.sub }}>
              View hospital-generated slots and block available slots when you are unavailable.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Available', value: counts.available, color: '#15803d' },
            { label: 'Booked', value: counts.booked, color: '#c2410c' },
            { label: 'Blocked', value: counts.blocked, color: '#b91c1c' },
          ].map((item) => (
            <motion.div
              key={item.label}
              variants={cardVariants}
              className="rounded-2xl bg-white border p-4"
              style={{ borderColor: T.border }}
            >
              <p className="text-xs font-semibold uppercase" style={{ color: T.sub }}>{item.label}</p>
              <p className="text-3xl font-extrabold mt-1" style={{ color: item.color }}>{item.value}</p>
            </motion.div>
          ))}
        </div>

        <motion.div variants={cardVariants} className="rounded-2xl bg-white border p-5 mb-6" style={{ borderColor: T.border }}>
          <div className="flex items-center gap-2 mb-4">
            <FiInfo style={{ color: T.orange }} />
            <h2 className="font-bold" style={{ color: T.dark }}>Hospital Schedule Rules</h2>
          </div>
          {schedules.loading ? (
            <p className="text-sm" style={{ color: T.sub }}>Loading schedule...</p>
          ) : scheduleList.length === 0 ? (
            <p className="text-sm" style={{ color: T.sub }}>
              Your hospital admin has not created a schedule yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {scheduleList.map((schedule) => (
                <div key={schedule.schedule_id} className="rounded-xl border p-4" style={{ borderColor: T.border, backgroundColor: T.bg }}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold" style={{ color: T.dark }}>{typeLabel(schedule.consultation_type)}</p>
                      <p className="text-xs mt-1 capitalize" style={{ color: T.sub }}>
                        {(schedule.working_days || []).join(', ')}
                      </p>
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
                  <div className="grid grid-cols-3 gap-2 mt-4 text-sm">
                    <div>
                      <p className="text-xs" style={{ color: T.sub }}>Hours</p>
                      <p className="font-semibold" style={{ color: T.dark }}>
                        {String(schedule.start_time).slice(0, 5)}-{String(schedule.end_time).slice(0, 5)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: T.sub }}>Duration</p>
                      <p className="font-semibold" style={{ color: T.dark }}>{schedule.slot_duration_minutes} min</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{ color: T.sub }}>Fee</p>
                      <p className="font-semibold" style={{ color: T.dark }}>₹{Number(schedule.consultation_fee || 0).toFixed(0)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <motion.div variants={cardVariants} className="rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => shiftMonth(-1)} className="p-2 rounded-full hover:bg-orange-50" aria-label="Previous month">
                <FiChevronLeft style={{ color: T.dark }} />
              </button>
              <h3 className="font-bold" style={{ color: T.dark }}>{format(viewMonth, 'MMMM yyyy')}</h3>
              <button onClick={() => shiftMonth(1)} className="p-2 rounded-full hover:bg-orange-50" aria-label="Next month">
                <FiChevronRight style={{ color: T.dark }} />
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {WEEKDAYS.map((w, i) => (
                <div key={`${w}-${i}`} className="text-[11px] font-semibold" style={{ color: T.sub }}>{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {calendarCells.map((date, i) => {
                if (!date) return <div key={`empty-${i}`} />;
                const hasSlots = !!slotsByDate[date];
                const isSelected = date === selectedDate;
                const isToday = date === today;
                return (
                  <button
                    key={date}
                    onClick={() => setSelectedDate(date)}
                    className="relative aspect-square rounded-lg text-sm flex items-center justify-center transition cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? T.orange : isToday ? T.tint : 'transparent',
                      color: isSelected ? '#fff' : T.dark,
                      fontWeight: isToday || isSelected ? 700 : 400,
                    }}
                  >
                    {Number(date.slice(-2))}
                    {hasSlots && !isSelected && (
                      <span className="absolute bottom-1 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: T.orange }} />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>

          <motion.div variants={cardVariants} className="rounded-2xl p-5 bg-white border" style={{ borderColor: T.border }}>
            <div className="flex items-center gap-2 mb-4">
              <FiCalendar style={{ color: T.orange }} />
              <h2 className="font-bold" style={{ color: T.dark }}>{safeDate(selectedDate)}</h2>
            </div>
            {slots.loading ? (
              <p className="text-sm" style={{ color: T.sub }}>Loading slots...</p>
            ) : selectedSlots.length === 0 ? (
              <p className="text-sm" style={{ color: T.sub }}>No generated slots on this date.</p>
            ) : (
              <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
                {selectedSlots.map((slot) => {
                  const status = slot.status || (slot.is_booked ? 'booked' : 'available');
                  const style = STATUS_STYLE[status] || STATUS_STYLE.available;
                  const canBlock = status === 'available' && !slot.is_booked && !slot.is_blocked;
                  return (
                    <div
                      key={slot.slot_id}
                      className="rounded-xl border p-3"
                      style={{ backgroundColor: style.bg, borderColor: style.border }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold flex items-center gap-1.5" style={{ color: style.text }}>
                            <FiClock className="w-4 h-4" />
                            {String(slot.start_time).slice(0, 5)}-{String(slot.end_time).slice(0, 5)}
                          </p>
                          <p className="text-xs mt-1 capitalize" style={{ color: T.sub }}>
                            {typeLabel(slot.consult_type)} · ₹{Number(slot.consultation_fee || 0).toFixed(0)}
                          </p>
                          {slot.block_reason && (
                            <p className="text-xs mt-1" style={{ color: '#b91c1c' }}>{slot.block_reason}</p>
                          )}
                        </div>
                        <span className="text-xs font-semibold capitalize" style={{ color: style.text }}>
                          {status}
                        </span>
                      </div>
                      {canBlock && (
                        <button
                          onClick={() => { setBlockSlot(slot); setBlockReason(''); }}
                          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-white cursor-pointer"
                          style={{ backgroundColor: T.dark }}
                        >
                          <FiLock className="w-3.5 h-3.5" /> Block Slot
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>

      <Modal isOpen={Boolean(blockSlot)} onClose={() => setBlockSlot(null)} title="Block Slot">
        <form onSubmit={submitBlock} className="space-y-4">
          <div className="rounded-xl p-3 border" style={{ borderColor: T.border, backgroundColor: T.bg }}>
            <p className="font-semibold" style={{ color: T.dark }}>
              {blockSlot?.slot_date} · {String(blockSlot?.start_time || '').slice(0, 5)}-{String(blockSlot?.end_time || '').slice(0, 5)}
            </p>
            <p className="text-xs mt-1" style={{ color: T.sub }}>
              Only available slots can be blocked. Booked slots stay protected.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: T.sub }}>Reason</label>
            <textarea
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              rows={3}
              className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
              style={{ borderColor: T.border }}
              placeholder="Unavailable for ward rounds, emergency duty, leave..."
            />
          </div>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setBlockSlot(null)} className="btn-orange-outline">Cancel</button>
            <button type="submit" disabled={blocking} className="btn-orange disabled:opacity-60">
              {blocking ? 'Blocking...' : 'Block Slot'}
            </button>
          </div>
        </form>
      </Modal>
    </DoctorLayout>
  );
};

export default ManageSlots;
