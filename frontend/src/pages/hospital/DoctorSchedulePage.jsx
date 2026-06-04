import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import { cleanDoctorName } from '../../utils/nameUtils';

const AVAILABILITY_INFO = {
  in_consultation: {
    label: 'In Consultation', color: '#F97316', bg: '#FFF7ED', dot: '#F97316', icon: '🔴',
  },
  has_slots: {
    label: 'Available', color: '#22C55E', bg: '#F0FDF4', dot: '#22C55E', icon: '🟢',
  },
  done_for_day: {
    label: 'Done for Today', color: '#666666', bg: '#F3F4F6', dot: '#666666', icon: '⚫',
  },
  no_slots: {
    label: 'No Schedule', color: '#999999', bg: '#FAFAFA', dot: '#CCCCCC', icon: '⚪',
  },
};

const SLOT_COLOR = {
  available:   { bg: '#F0FDF4', border: '#86EFAC', text: '#16A34A' },
  booked:      { bg: '#FFF7ED', border: '#FED7AA', text: '#F97316' },
  in_progress: { bg: '#FEF2F2', border: '#FCA5A5', text: '#DC2626' },
  completed:   { bg: '#F3F4F6', border: '#D1D5DB', text: '#9CA3AF' },
  past:        { bg: '#F9FAFB', border: '#E5E7EB', text: '#9CA3AF' },
};

const FILTER_TABS = [
  { key: 'all',             label: 'All Doctors' },
  { key: 'in_consultation', label: '🔴 In Consultation' },
  { key: 'has_slots',       label: '🟢 Available' },
  { key: 'done_for_day',    label: '⚫ Done' },
  { key: 'no_slots',        label: '⚪ No Schedule' },
];

const todayISO = () => new Date().toISOString().split('T')[0];

const DoctorSchedulePage = () => {
  const [schedule, setSchedule] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [loading, setLoading] = useState(true);
  const [expandedDoctor, setExpandedDoctor] = useState(null);
  const [filterAvailability, setFilterAvailability] = useState('all');

  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        setLoading(true);
        const res = await API.get(`/api/hospital/doctor-schedule/?date=${selectedDate}`);
        if (res.data?.success) {
          setSchedule(res.data.data || []);
          setSummary(res.data.summary || null);
        }
      } catch (e) {
        /* best-effort */
      } finally {
        setLoading(false);
      }
    };
    fetchSchedule();
  }, [selectedDate]);

  const filteredSchedule = schedule.filter(
    (d) => filterAvailability === 'all' || d.availability === filterAvailability,
  );

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-black">📅 Doctor Schedule</h1>
            <p className="text-gray-500 text-sm mt-1">
              View all doctor availability and today's consultations
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
              className="px-4 py-2 rounded-xl text-sm font-medium text-white"
              style={{ backgroundColor: '#F97316' }}
            >
              Today
            </button>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-2xl p-4 border border-gray-100 text-center">
              <p className="text-2xl font-bold text-black">{summary.total_doctors}</p>
              <p className="text-xs text-gray-500 mt-1">👨‍⚕️ Total Doctors</p>
            </div>
            <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: '#FEF2F2' }}>
              <p className="text-2xl font-bold text-red-600">{summary.in_consultation}</p>
              <p className="text-xs text-red-500 mt-1">🔴 In Consultation</p>
            </div>
            <div className="rounded-2xl p-4 text-center" style={{ backgroundColor: '#F0FDF4' }}>
              <p className="text-2xl font-bold text-green-600">{summary.has_slots}</p>
              <p className="text-xs text-green-500 mt-1">🟢 Available</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-600">{summary.no_slots}</p>
              <p className="text-xs text-gray-400 mt-1">⚪ No Schedule</p>
            </div>
          </div>
        )}

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {FILTER_TABS.map((tab) => {
            const active = filterAvailability === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setFilterAvailability(tab.key)}
                className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active ? '#F97316' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#000000',
                  border: active ? 'none' : '1px solid #E5E5E5',
                }}
              >
                {tab.label}
                {tab.key !== 'all' && summary && (
                  <span className="ml-1">({summary[tab.key] || 0})</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading schedule...</p>
          </div>
        )}

        {/* Doctor cards */}
        {!loading && (
          <div className="space-y-3">
            {filteredSchedule.length === 0 ? (
              <div className="bg-white rounded-2xl p-12 text-center">
                <p className="text-4xl mb-3">📅</p>
                <p className="font-semibold text-gray-700">No doctors found</p>
              </div>
            ) : (
              filteredSchedule.map((doctor) => {
                const availInfo = AVAILABILITY_INFO[doctor.availability] || AVAILABILITY_INFO.no_slots;
                const isExpanded = expandedDoctor === doctor.doctor_id;

                return (
                  <motion.div
                    key={doctor.doctor_id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl border border-gray-100 overflow-hidden"
                  >
                    <button
                      onClick={() => setExpandedDoctor(isExpanded ? null : doctor.doctor_id)}
                      className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-4">
                        <div
                          className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                          style={{ backgroundColor: '#F97316' }}
                        >
                          {doctor.full_name?.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-black">{cleanDoctorName(doctor.full_name)}</p>
                          <p className="text-sm text-gray-500">{doctor.specialization || 'General'}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {doctor.completed_slots}/{doctor.booked_slots} completed · {doctor.total_slots} total slots
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span
                          className="px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1"
                          style={{ backgroundColor: availInfo.bg, color: availInfo.color }}
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: availInfo.dot }} />
                          {availInfo.label}
                        </span>
                        <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                          ▼
                        </span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-50">
                        {doctor.slots.length === 0 ? (
                          <p className="text-center text-gray-400 text-sm py-4">
                            No slots scheduled
                          </p>
                        ) : (
                          <div className="mt-3">
                            <p className="text-xs text-gray-500 mb-2 font-medium">Time Slots:</p>
                            <div className="flex flex-wrap gap-2">
                              {doctor.slots.map((slot) => {
                                const c = SLOT_COLOR[slot.status] || SLOT_COLOR.available;
                                return (
                                  <div
                                    key={slot.slot_id}
                                    className="px-3 py-2 rounded-xl border text-xs"
                                    style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}
                                  >
                                    <p className="font-semibold">
                                      {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                                    </p>
                                    {slot.patient_name && (
                                      <p className="truncate max-w-24 mt-0.5">👤 {slot.patient_name}</p>
                                    )}
                                    <p className="capitalize mt-0.5">
                                      {String(slot.status).replace('_', ' ')}
                                      {slot.consult_type === 'online' ? ' 💻' : ' 🏥'}
                                    </p>
                                  </div>
                                );
                              })}
                            </div>

                            {doctor.booked_slots > 0 && (
                              <div className="mt-3">
                                <div className="flex justify-between text-xs text-gray-400 mb-1">
                                  <span>Progress</span>
                                  <span>{doctor.completed_slots}/{doctor.booked_slots} done</span>
                                </div>
                                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full"
                                    style={{
                                      width: `${(doctor.completed_slots / doctor.booked_slots) * 100}%`,
                                      backgroundColor: '#F97316',
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                );
              })
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default DoctorSchedulePage;
