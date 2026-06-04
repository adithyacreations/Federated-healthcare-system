import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FiCalendar, FiPlus, FiFileText, FiHome, FiSearch, FiUser } from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { T, DoctorAvatar } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import Modal from '../../components/common/Modal';
import ConsultationChat from '../../components/consultation/ConsultationChat';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const TABS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
];

const PAST_STATUSES = ['completed', 'cancelled'];

const ConsultationsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const consultations = useApi('/api/doctor/consultations/');
  const [tab, setTab] = useState('today');
  const [notesModal, setNotesModal] = useState(null);
  const [chatConsult, setChatConsult] = useState(null);

  // Tick every second so the Join button flips active exactly at the start time.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Offline (physical visit) flow
  const [showOfflineModal, setShowOfflineModal] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [searching, setSearching] = useState(false);
  const [startingOffline, setStartingOffline] = useState(false);

  const today = format(new Date(), 'yyyy-MM-dd');

  const { todayList, upcomingList, pastList } = useMemo(() => {
    const all = consultations.data || [];
    const todayList = [];
    const upcomingList = [];
    const pastList = [];
    for (const c of all) {
      if (PAST_STATUSES.includes(c.status)) pastList.push(c);
      else if (c.consult_mode === 'offline' || c.slot_date === today) todayList.push(c);
      else if (c.slot_date && c.slot_date > today) upcomingList.push(c);
      else pastList.push(c);
    }
    upcomingList.sort((a, b) => (a.slot_date || '').localeCompare(b.slot_date || ''));
    pastList.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return { todayList, upcomingList, pastList };
  }, [consultations.data, today]);

  const lists = { today: todayList, upcoming: upcomingList, past: pastList };
  const activeList = lists[tab];

  const safeFmt = (iso, fmt = 'dd MMM yyyy') => {
    if (!iso) return '—';
    try { return format(new Date(iso), fmt); } catch { return iso; }
  };

  // ─── Offline (physical visit) ─────────────────────────────────
  const searchPatients = async () => {
    if (patientSearch.trim().length < 2) return toast.error('Type at least 2 characters');
    setSearching(true);
    try {
      const { data } = await API.get(`/api/doctor/search-patient/?q=${encodeURIComponent(patientSearch.trim())}`);
      const results = data?.data || [];
      setSearchResults(results);
      if (results.length === 0) toast.error('No patients found');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const startOfflineConsultation = async () => {
    if (!selectedPatient) return;
    setStartingOffline(true);
    try {
      const { data } = await API.post('/api/doctor/offline-consultation/create/', { patient_id: selectedPatient.patient_id });
      toast.success('Physical visit started ✅');
      closeOfflineModal();
      navigate(`/doctor/offline-consultation/${data.data.consultation_id}`);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to start visit');
    } finally {
      setStartingOffline(false);
    }
  };

  const closeOfflineModal = () => {
    setShowOfflineModal(false);
    setSelectedPatient(null);
    setPatientSearch('');
    setSearchResults([]);
  };

  // Join/Open unlocks EXACTLY at slot start (1-min lead for loading) and locks
  // again once the end time passes. Recomputed every second via the tick above.
  const getButtonStatus = (c) => {
    if (c.consult_mode === 'offline') return { enabled: true, reason: '' };
    if (!c.slot_date || !c.start_time || !c.end_time) return { enabled: true, reason: '' };
    const now = new Date();
    const start = new Date(`${c.slot_date}T${c.start_time}`);
    const end = new Date(`${c.slot_date}T${c.end_time}`);
    if (Number.isNaN(start.getTime())) return { enabled: true, reason: '' };

    const joinFrom = new Date(start.getTime() - 60 * 1000); // 1 min before start
    if (now > end) return { enabled: false, reason: 'Consultation time has ended' };
    if (now >= joinFrom) return { enabled: true, reason: '' };

    const diff = start.getTime() - now.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const reason = h > 0
      ? `Starts in ${h}h ${m}m`
      : m > 0
        ? `Starts in ${m}m ${String(s).padStart(2, '0')}s`
        : `Starts in ${s}s`;
    return { enabled: false, reason };
  };

  const statusBadge = (status) => (
    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize"
      style={{ backgroundColor: status === 'ongoing' ? T.orange : status === 'completed' ? T.dark : '#f3f4f6', color: ['ongoing', 'completed'].includes(status) ? '#fff' : T.sub }}>
      {status}
    </span>
  );

  // ─── Active / upcoming card ───────────────────────────────────
  const renderActiveCard = (c) => {
    const isOffline = c.consult_mode === 'offline';
    const isOnline = !isOffline && c.consult_type !== 'in_person';
    const btn = getButtonStatus(c);
    const target = isOffline ? `/doctor/offline-consultation/${c.consultation_id}` : `/doctor/consultation/${c.consultation_id}`;
    const label = isOffline ? '🏥 Open Visit' : isOnline ? '📹 Start Call' : '▶ Start';
    return (
      <motion.div key={c.consultation_id} variants={cardVariants} className="rounded-2xl p-4 bg-white border flex flex-wrap items-center justify-between gap-3" style={{ borderColor: T.border }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="text-sm font-bold w-16 shrink-0" style={{ color: T.orange }}>{c.start_time || '--:--'}</div>
          <DoctorAvatar name={c.patient_name} size={42} />
          <div className="min-w-0">
            <div className="font-semibold truncate" style={{ color: T.dark }}>{c.patient_name}</div>
            <div className="text-xs flex flex-wrap items-center gap-1.5" style={{ color: T.sub }}>
              <span>{safeFmt(c.slot_date)}</span>
              {c.start_time && <span style={{ color: T.orange }} className="font-medium">{c.start_time} → {c.end_time || '—'}</span>}
              <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>
                {isOffline ? '🏥 Physical' : '💻 Online'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(c.status)}
          <div className="text-right">
            <button
              onClick={() => navigate(target)}
              disabled={!btn.enabled}
              className="px-4 py-2 rounded-full text-xs font-semibold transition"
              style={btn.enabled ? { backgroundColor: T.orange, color: '#fff' } : { backgroundColor: '#f3f4f6', color: '#9ca3af', cursor: 'not-allowed' }}
            >
              {btn.enabled ? label : '🔒 Locked'}
            </button>
            {!btn.enabled && <p className="text-[11px] mt-1" style={{ color: T.sub }}>{btn.reason}</p>}
          </div>
          <button onClick={() => setChatConsult(c)} className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-medium border" style={{ color: T.orange, borderColor: T.orange }}>
            💬 Message
          </button>
          <Link to={`/doctor/patient-ehr/${c.patient_uuid || ''}`} className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-medium border" style={{ color: T.dark, borderColor: T.border }}>
            <FiUser className="w-3.5 h-3.5" /> EHR
          </Link>
        </div>
      </motion.div>
    );
  };

  // ─── Past card ────────────────────────────────────────────────
  const renderPastCard = (c) => (
    <motion.div key={c.consultation_id} variants={cardVariants} className="rounded-2xl p-4 border flex flex-wrap items-center justify-between gap-3" style={{ backgroundColor: T.bg, borderColor: T.border }}>
      <div className="flex items-center gap-3 min-w-0">
        <DoctorAvatar name={c.patient_name} size={42} />
        <div className="min-w-0">
          <div className="font-semibold truncate" style={{ color: T.dark }}>{c.patient_name}</div>
          <div className="text-xs" style={{ color: T.sub }}>
            {safeFmt(c.slot_date)}{c.final_diagnosis && ` · ${c.final_diagnosis}`}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {statusBadge(c.status)}
        <button onClick={() => setNotesModal(c)} className="inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-medium border" style={{ color: T.dark, borderColor: T.border }}>
          <FiFileText className="w-3.5 h-3.5" /> View Notes
        </button>
      </div>
    </motion.div>
  );

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>Consultations</h1>
            <p className="text-sm" style={{ color: T.sub }}>Manage your appointments</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowOfflineModal(true)} className="inline-flex items-center gap-1.5 text-white px-4 py-2 rounded-full text-sm font-semibold" style={{ backgroundColor: T.orange }}>
              <FiHome className="w-4 h-4" /> New Physical Visit
            </button>
            <Link to="/doctor/slots" className="inline-flex items-center gap-1.5 text-white px-4 py-2 rounded-full text-sm font-semibold" style={{ backgroundColor: T.dark }}>
              <FiPlus className="w-4 h-4" /> Add Slot
            </Link>
          </div>
        </div>

        {/* Tabs with animated underline */}
        <div className="flex gap-6 mb-5 border-b" style={{ borderColor: T.border }}>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="relative pb-2.5 text-sm font-semibold transition" style={{ color: tab === t.key ? T.orange : T.sub }}>
              {t.label}
              <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full" style={{ backgroundColor: tab === t.key ? T.tint : '#f3f4f6', color: tab === t.key ? T.orange : T.sub }}>
                {lists[t.key].length}
              </span>
              {tab === t.key && <motion.span layoutId="consult-underline" className="absolute left-0 right-0 -bottom-px h-0.5 rounded" style={{ backgroundColor: T.orange }} />}
            </button>
          ))}
        </div>

        {consultations.loading ? (
          <div className="rounded-2xl p-6 bg-white border text-sm" style={{ borderColor: T.border, color: T.sub }}>Loading consultations…</div>
        ) : consultations.error ? (
          <div className="rounded-2xl p-6 bg-white border text-sm text-red-500" style={{ borderColor: T.border }}>Could not load consultations.</div>
        ) : activeList.length === 0 ? (
          <div className="rounded-2xl p-10 bg-white border text-center" style={{ borderColor: T.border, color: T.sub }}>
            <FiCalendar className="w-9 h-9 mx-auto text-gray-300 mb-2" />
            <div className="text-sm">No {tab} consultations.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {activeList.map((c) => (tab === 'past' ? renderPastCard(c) : renderActiveCard(c)))}
          </div>
        )}
      </motion.div>

      {/* View Notes modal */}
      <Modal isOpen={Boolean(notesModal)} onClose={() => setNotesModal(null)} title={notesModal ? `Consultation — ${notesModal.patient_name}` : ''}>
        {notesModal && (
          <div className="space-y-4 text-sm">
            <div>
              <div className="text-xs uppercase text-gray-400 mb-1">Date</div>
              <div style={{ color: T.dark }}>{safeFmt(notesModal.slot_date)} · {notesModal.slot_time || '—'}</div>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-400 mb-1">Doctor Notes</div>
              <p className="whitespace-pre-wrap" style={{ color: T.dark }}>{notesModal.doctor_notes || 'No notes recorded.'}</p>
            </div>
            <div>
              <div className="text-xs uppercase text-gray-400 mb-1">Final Diagnosis</div>
              <p style={{ color: T.dark }}>{notesModal.final_diagnosis || 'Not recorded.'}</p>
            </div>
            {Array.isArray(notesModal.ai_suggestions?.top_diagnoses) && notesModal.ai_suggestions.top_diagnoses.length > 0 && (
              <div>
                <div className="text-xs uppercase text-gray-400 mb-1">AI Suggestions</div>
                <ul className="space-y-0.5" style={{ color: T.dark }}>
                  {notesModal.ai_suggestions.top_diagnoses.map((dx, i) => (<li key={i}>• {dx.disease} — {dx.confidence}%</li>))}
                </ul>
              </div>
            )}
            <div className="pt-2 border-t" style={{ borderColor: T.border }}>
              <Link to={`/doctor/patient-ehr/${notesModal.patient_uuid || ''}`} className="text-sm hover:underline" style={{ color: T.orange }}>
                View prescriptions &amp; lab orders in patient EHR →
              </Link>
            </div>
          </div>
        )}
      </Modal>

      {/* Pre-call chat modal — message the patient before the consultation */}
      <Modal
        isOpen={Boolean(chatConsult)}
        onClose={() => setChatConsult(null)}
        title={chatConsult ? `💬 Message — ${chatConsult.patient_name}` : ''}
      >
        {chatConsult && (
          <ConsultationChat
            consultationId={chatConsult.consultation_id}
            sender="doctor"
            senderName={`Dr. ${user?.full_name || ''}`.trim()}
          />
        )}
      </Modal>

      {/* New Physical Visit modal */}
      <Modal isOpen={showOfflineModal} onClose={closeOfflineModal} title="🏥 Start Physical Visit">
        <div className="space-y-3">
          <p className="text-sm" style={{ color: T.sub }}>Search patient by name or email:</p>
          <div className="flex gap-2">
            <input
              value={patientSearch}
              onChange={(e) => { setPatientSearch(e.target.value); setSearchResults([]); setSelectedPatient(null); }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchPatients())}
              placeholder="Type patient name…"
              className="flex-1 border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
              style={{ borderColor: T.border }}
            />
            <button onClick={searchPatients} disabled={searching} className="inline-flex items-center gap-1.5 text-white px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ backgroundColor: T.orange }}>
              <FiSearch className="w-4 h-4" /> {searching ? '…' : 'Search'}
            </button>
          </div>

          {searchResults.length > 0 && !selectedPatient && (
            <div className="border rounded-xl overflow-hidden max-h-48 overflow-y-auto" style={{ borderColor: T.border }}>
              {searchResults.map((p) => (
                <button key={p.patient_id} onClick={() => { setSelectedPatient(p); setSearchResults([]); }} className="w-full px-4 py-3 text-left hover:bg-orange-50 border-b last:border-0" style={{ borderColor: '#f3f4f6' }}>
                  <p className="font-medium" style={{ color: T.dark }}>{p.full_name}</p>
                  <p className="text-xs" style={{ color: T.sub }}>{p.email} · {p.blood_group || '—'} · Age {p.age ?? '—'}</p>
                </button>
              ))}
            </div>
          )}

          {selectedPatient && (
            <div className="rounded-xl p-3 flex items-center justify-between" style={{ backgroundColor: T.tint, border: `1px solid #FED7AA` }}>
              <div>
                <p className="font-semibold" style={{ color: T.orange }}>✅ {selectedPatient.full_name}</p>
                <p className="text-xs" style={{ color: T.sub }}>{selectedPatient.email} · {selectedPatient.blood_group || '—'}</p>
              </div>
              <button onClick={() => setSelectedPatient(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={startOfflineConsultation} disabled={!selectedPatient || startingOffline} className="inline-flex items-center justify-center gap-1.5 text-white px-4 py-3 rounded-xl flex-1 font-semibold disabled:opacity-50" style={{ backgroundColor: T.orange }}>
              <FiHome className="w-4 h-4" /> {startingOffline ? 'Starting…' : 'Start Physical Visit'}
            </button>
            <button onClick={closeOfflineModal} className="flex-1 rounded-xl font-semibold text-white" style={{ backgroundColor: T.dark }}>Cancel</button>
          </div>
        </div>
      </Modal>
    </DoctorLayout>
  );
};

export default ConsultationsPage;
