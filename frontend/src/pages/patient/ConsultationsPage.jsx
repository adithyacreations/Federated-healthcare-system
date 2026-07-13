import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  FiAlertTriangle,
  FiCalendar,
  FiCreditCard,
  FiDownload,
  FiMessageCircle,
  FiSearch,
  FiShoppingCart,
  FiUser,
  FiVideo,
  FiXCircle,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import AnimatedTabs from '../../components/patient/AnimatedTabs';
import StepIndicator from '../../components/patient/StepIndicator';
import { pageVariants, cardVariants, cardHover } from '../../components/dashboard/variants';
import ConsultationChat from '../../components/consultation/ConsultationChat';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { usePatientWS } from '../../context/PatientWebSocketContext';
import { openRazorpay } from '../../utils/payment';
import { downloadBillPdf } from '../../utils/pdf';
import { cleanDoctorName } from '../../utils/nameUtils';

const BOOK_STEPS = ['Select Doctor', 'Choose Slot', 'Confirm', 'Pay'];

// Future = slot starts later than "now". Backend already marks past-and-unattended
// rows as status='missed', but we double-check on the frontend so the tabs are
// resilient to clock drift.
const isFutureSlot = (c) => {
  if (!c.slot_date || !c.start_time) return false;
  const slot = new Date(`${c.slot_date}T${c.start_time}`);
  return !Number.isNaN(slot.getTime()) && slot > new Date();
};

const isPastEndedSlot = (c) => {
  if (!c.slot_date || !c.end_time) return false;
  const slot = new Date(`${c.slot_date}T${c.end_time}`);
  return !Number.isNaN(slot.getTime()) && slot < new Date();
};

const bucketize = (c) => {
  if (c.payment_status === 'pending' && c.status !== 'cancelled') return 'pending_payment';
  if (c.status === 'cancelled') return 'cancelled';
  if (c.status === 'completed') return 'past';
  if (c.status === 'missed' || isPastEndedSlot(c)) return 'missed';
  if (
    c.payment_status === 'paid'
    && (isFutureSlot(c) || c.status === 'scheduled' || c.status === 'ongoing')
  ) return 'upcoming';
  return 'upcoming';
};

const TABS = [
  { key: 'upcoming',  label: '📅 Upcoming' },
  { key: 'missed',    label: '⚠️ Missed' },
  { key: 'past',      label: '✓ Completed' },
  { key: 'cancelled', label: '✕ Cancelled' },
];

const TAB_LABELS = {
  upcoming: 'Upcoming',
  missed: 'Missed',
  past: 'Completed',
  cancelled: 'Cancelled',
  pending_payment: 'Pending Payment',
};

const CONSULTATION_TABS = [
  { key: 'pending_payment', label: TAB_LABELS.pending_payment },
  ...TABS,
].map((tab) => ({ ...tab, label: TAB_LABELS[tab.key] || tab.label }));

const fmtSlotDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
};

const toDateInputValue = (date = new Date()) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

// A slot is bookable only until the moment it starts. Once today's start_time
// has passed it's hidden — patients can't join a consultation already underway.
// Matches the backend's start_time filter and re-runs each minute on the client.
const isSlotAvailable = (slot, now = new Date()) => {
  if (!slot.slot_date || !slot.start_time) return false;
  // The slot's date + start_time fully specify its start moment (parsed as local
  // time, like the rest of this file). It's bookable only until that moment —
  // future dates pass, and today's slot drops off the instant it starts.
  const slotStart = new Date(`${slot.slot_date}T${slot.start_time}`);
  return !Number.isNaN(slotStart.getTime()) && slotStart > now;
};

// Avoid the "Dr. Dr." double prefix when a name already starts with "Dr.".
const withDr = (name) => cleanDoctorName(name) || 'Doctor';

const doctorPhoto = (doctor) => doctor?.profile_photo || doctor?.doctor_profile_photo || '';

const departmentPhoto = (doctor) => doctor?.department_photo || doctor?.dept_photo || '';

const typeLabel = (value) => {
  if (value === 'both') return 'Online or offline';
  if (value === 'offline' || value === 'in_person') return 'Offline';
  return 'Online';
};

const formatRemaining = (seconds) => {
  const safe = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const ConsultationsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { subscribe } = usePatientWS() || {};
  // pollInterval = 5-min fallback refresh in case the WebSocket drops.
  const doctors = useApi('/api/patient/doctors/', { pollInterval: 300000 });
  const consults = useApi('/api/patient/consultations/');

  // Live updates via the shared patient notification socket. Refs keep the
  // subscriptions stable so they don't re-bind on every refetch.
  const doctorsRef = useRef(doctors);
  doctorsRef.current = doctors;
  const consultsRef = useRef(consults);
  consultsRef.current = consults;
  const expiredHoldRefreshRef = useRef(new Set());
  const pendingAutoFocusDoneRef = useRef(false);
  // Tracks the doctor whose slot picker is open, so a live slot update can
  // refresh just those slots. Synced from `slotDoctor` state below.
  const slotDoctorRef = useRef(null);
  useEffect(() => {
    if (!subscribe) return undefined;
    // New doctor added → silently refresh the bookable list.
    const unsubDoctor = subscribe('doctor', () => {
      doctorsRef.current.refetch(true);
      toast.success('🎉 New doctor available!');
    });
    // Consultation booked/cancelled/reminded → refresh my consultations.
    const unsubConsult = subscribe('consultation', () => {
      consultsRef.current.refetch();
    });
    // Doctor added new slots → refresh the bookable list (available_slots_count)
    // and, if this patient has that doctor's slot picker open, its slots too.
    const unsubSlots = subscribe('slots', (data) => {
      doctorsRef.current.refetch(true);
      toast.success(`🗓️ ${data?.message || 'New consultation slots available!'}`);
      const openDoc = slotDoctorRef.current;
      if (openDoc && (!data?.related_id || openDoc.doctor_id === data.related_id)) {
        API.get(`/api/patient/doctor-slots/${openDoc.doctor_id}/`)
          .then(({ data: r }) => setSlots(r?.data?.slots || []))
          .catch(() => { /* best-effort; modal keeps its current slots */ });
      }
    });
    return () => { unsubDoctor(); unsubConsult(); unsubSlots(); };
  }, [subscribe]);

  const [tab, setTab] = useState('upcoming');
  const [search, setSearch] = useState('');
  const [specFilter, setSpecFilter] = useState('All');
  const [slotDoctor, setSlotDoctor] = useState(null);
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlotDate, setSelectedSlotDate] = useState(toDateInputValue());
  const [selectedBookingSlot, setSelectedBookingSlot] = useState(null);
  // Keep the ref in sync so the 'slots' WS handler reads the latest open doctor.
  useEffect(() => { slotDoctorRef.current = slotDoctor; }, [slotDoctor]);
  const [booking, setBooking] = useState(false);
  const [payingPending, setPayingPending] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [cancellingPendingId, setCancellingPendingId] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [chatConsult, setChatConsult] = useState(null);

  // Tick every second so the Join button flips to active exactly at the start
  // time and the countdown shows live seconds; also auto-hides started slots.
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const getHoldSecondsRemaining = (consultation) => {
    if (consultation?.payment_hold_expires_at) {
      const expiresAt = new Date(consultation.payment_hold_expires_at).getTime();
      if (!Number.isNaN(expiresAt)) {
        return Math.max(0, Math.floor((expiresAt - currentTime.getTime()) / 1000));
      }
    }
    return Math.max(0, Number(consultation?.hold_seconds_remaining || 0));
  };

  // Bookable slots, recomputed on each tick so started slots drop off live.
  const availableSlots = useMemo(
    () => (slots || []).filter((s) => isSlotAvailable(s, currentTime)),
    [slots, currentTime],
  );

  const availableSlotDates = useMemo(
    () => Array.from(new Set(availableSlots.map((slot) => slot.slot_date))).filter(Boolean).sort(),
    [availableSlots],
  );

  const selectedDateSlots = useMemo(
    () => availableSlots
      .filter((slot) => slot.slot_date === selectedSlotDate)
      .sort((a, b) => String(a.start_time || '').localeCompare(String(b.start_time || ''))),
    [availableSlots, selectedSlotDate],
  );

  useEffect(() => {
    if (!slotDoctor || availableSlotDates.length === 0) return;
    if (!availableSlotDates.includes(selectedSlotDate)) {
      setSelectedSlotDate(availableSlotDates[0]);
    }
  }, [availableSlotDates, selectedSlotDate, slotDoctor]);

  useEffect(() => {
    if (!selectedBookingSlot) return;
    const stillVisible = selectedDateSlots.some((slot) => slot.slot_id === selectedBookingSlot.slot_id);
    if (selectedBookingSlot.slot_date !== selectedSlotDate || !stillVisible) {
      setSelectedBookingSlot(null);
    }
  }, [selectedBookingSlot, selectedDateSlots, selectedSlotDate]);

  const doctorList = useMemo(() => doctors.data?.doctors || [], [doctors.data]);
  const allConsults = useMemo(() => consults.data?.consultations || [], [consults.data]);

  useEffect(() => {
    const expired = allConsults.find((consultation) => {
      if (consultation.payment_status !== 'pending' || !consultation.payment_hold_expires_at) return false;
      if (expiredHoldRefreshRef.current.has(consultation.consultation_id)) return false;
      const expiresAt = new Date(consultation.payment_hold_expires_at).getTime();
      return !Number.isNaN(expiresAt) && expiresAt <= currentTime.getTime();
    });
    if (!expired) return;
    expiredHoldRefreshRef.current.add(expired.consultation_id);
    consults.refetch();
    doctors.refetch(true);
  }, [allConsults, currentTime, consults, doctors]);

  const specializations = useMemo(() => {
    const set = new Set(doctorList.map((d) => d.specialization).filter(Boolean));
    return ['All', ...Array.from(set)];
  }, [doctorList]);

  const filteredDoctors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doctorList.filter((d) => {
      if (specFilter !== 'All' && d.specialization !== specFilter) return false;
      if (!q) return true;
      return (
        d.full_name.toLowerCase().includes(q) ||
        (d.specialization || '').toLowerCase().includes(q)
      );
    });
  }, [doctorList, search, specFilter]);

  // Group every consultation into one of the four tabs once, so we can show
  // tab counts AND filter the visible list off the same source of truth.
  const buckets = useMemo(() => {
    const out = { upcoming: [], missed: [], past: [], cancelled: [], pending_payment: [] };
    allConsults.forEach((c) => {
      out[bucketize(c)].push(c);
    });
    const byDate = (asc) => (a, b) => {
      const dA = new Date(`${a.slot_date}T${a.start_time || '00:00'}`).getTime();
      const dB = new Date(`${b.slot_date}T${b.start_time || '00:00'}`).getTime();
      return asc ? dA - dB : dB - dA;
    };
    out.upcoming.sort(byDate(true));
    out.missed.sort(byDate(false));
    out.past.sort(byDate(false));
    out.cancelled.sort(byDate(false));
    out.pending_payment.sort((a, b) => {
      const aCreated = new Date(a.created_at || 0).getTime();
      const bCreated = new Date(b.created_at || 0).getTime();
      if (aCreated !== bCreated) return bCreated - aCreated;
      const aExpiry = new Date(a.payment_hold_expires_at || 0).getTime();
      const bExpiry = new Date(b.payment_hold_expires_at || 0).getTime();
      return aExpiry - bExpiry;
    });
    return out;
  }, [allConsults]);

  useEffect(() => {
    if (pendingAutoFocusDoneRef.current || buckets.pending_payment.length === 0) return;
    pendingAutoFocusDoneRef.current = true;
    setTab('pending_payment');
  }, [buckets.pending_payment.length]);

  const filtered = buckets[tab] || [];

  // Time-locked Join button — active EXACTLY at the start time (with a 1-minute
  // lead for loading), and disabled again once the slot's end time passes. The
  // per-second `currentTime` tick keeps the countdown and the flip-to-active
  // accurate to the second.
  const getJoinButtonStatus = (c) => {
    if (!c.slot_date || !c.start_time) return { canJoin: false, label: 'No time set' };
    const now = currentTime;
    const start = new Date(`${c.slot_date}T${c.start_time}`);
    const end = new Date(`${c.slot_date}T${c.end_time || '23:59'}`);
    if (Number.isNaN(start.getTime())) return { canJoin: false, label: 'No time set' };

    const joinFrom = new Date(start.getTime() - 60 * 1000); // 1 min before start
    if (now > end) return { canJoin: false, label: '✓ Session Ended', isPast: true };
    if (now >= joinFrom) return { canJoin: true, label: '📹 Join Consultation' };

    const diff = start.getTime() - now.getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const label = h > 0
      ? `⏰ Starts in ${h}h ${m}m`
      : m > 0
        ? `⏰ Starts in ${m}m ${String(s).padStart(2, '0')}s`
        : `⏰ Starts in ${s}s`;
    return { canJoin: false, label };
  };

  const bookingStep = confirmation ? 2 : slotDoctor ? 1 : 0;

  const openSlots = async (doctor) => {
    setSlotDoctor(doctor);
    setSlots([]);
    setSlotsLoading(true);
    setSelectedSlotDate(toDateInputValue());
    setSelectedBookingSlot(null);
    try {
      const { data } = await API.get(`/api/patient/doctor-slots/${doctor.doctor_id}/`);
      // Store the raw list; availableSlots filters it live (and re-filters each minute).
      const loadedSlots = data?.data?.slots || [];
      setSlots(loadedSlots);
      if (loadedSlots[0]?.slot_date) setSelectedSlotDate(loadedSlots[0].slot_date);
    } catch {
      toast.error('Could not load slots');
    } finally {
      setSlotsLoading(false);
    }
  };

  const bookSlot = async (slot) => {
    if (!slotDoctor || !slot) return;
    setBooking(true);
    try {
      const { data } = await API.post('/api/patient/book-consultation/', {
        doctor_id: slotDoctor.doctor_id,
        slot_id: slot.slot_id,
        consult_type: slot.consult_type === 'both' ? 'online' : slot.consult_type,
      });
      const res = data?.data || {};
      const doctorName = slotDoctor.full_name;
      setSlotDoctor(null);
      setSelectedBookingSlot(null);
      const fee = Number(res.fee || 0);
      if (fee > 0) {
        if (!res.razorpay_order_id || !res.key_id) {
          toast.error('Payment order not created. Please try again.');
          consults.refetch();
          return;
        }
        openRazorpay({
          orderId: res.razorpay_order_id,
          amount: res.amount,
          keyId: res.key_id,
          paymentType: 'consultation',
          objectId: res.consultation_id,
          user,
          description: `Consultation with ${withDr(doctorName)}`,
          onSuccess: () => {
            setTab('upcoming');
            setConfirmation(res);
            consults.refetch();
            doctors.refetch(true);
          },
          onFailure: async () => {
            // Payment dismissed or failed: keep the 10-minute reservation hold.
            try {
              await API.post('/api/patient/consultation-payment-failed/', {
                consultation_id: res.consultation_id,
                reason: 'Payment cancelled',
              });
              toast.error('Payment pending. This slot is reserved for 10 minutes.');
            } catch { /* best-effort; refetch still reflects server state */ }
            setTab('pending_payment');
            consults.refetch();
            doctors.refetch(true);
          },
        });
      } else {
        setTab('upcoming');
        setConfirmation(res);
        consults.refetch();
        doctors.refetch(true);
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  };

  const payPendingConsultation = async (consultation) => {
    if (!consultation?.consultation_id) return;
    const holdRemaining = getHoldSecondsRemaining(consultation);
    if (holdRemaining <= 0) {
      toast.error('Payment hold expired. Please book a slot again.');
      consults.refetch();
      doctors.refetch(true);
      return;
    }
    if (!consultation.razorpay_order_id || !consultation.razorpay_key_id) {
      toast.error('Payment is not ready. Please refresh.');
      return;
    }

    setPayingPending(consultation.consultation_id);
    await openRazorpay({
      orderId: consultation.razorpay_order_id,
      amount: consultation.razorpay_amount || Math.round(Number(consultation.amount || 0) * 100),
      keyId: consultation.razorpay_key_id,
      paymentType: 'consultation',
      objectId: consultation.consultation_id,
      user,
      description: `Consultation with ${withDr(consultation.doctor_name)}`,
      onSuccess: () => {
        setPayingPending(null);
        setTab('upcoming');
        setConfirmation({
          ...consultation,
          slot_time: `${consultation.start_time || ''}${consultation.end_time ? ` - ${consultation.end_time}` : ''}`,
        });
        consults.refetch();
        doctors.refetch(true);
      },
      onFailure: () => {
        setPayingPending(null);
        toast.error('Payment pending. Complete it before the hold expires.');
        setTab('pending_payment');
        consults.refetch();
      },
    });
  };

  const cancelPendingPayment = async (consultation) => {
    if (!consultation?.consultation_id) return;
    const okToCancel = window.confirm(
      'Cancel this pending payment and release the reserved slot?',
    );
    if (!okToCancel) return;

    setCancellingPendingId(consultation.consultation_id);
    try {
      await API.post('/api/patient/consultation-payment-failed/', {
        consultation_id: consultation.consultation_id,
        reason: 'Patient cancelled pending payment',
        force_cancel: true,
      });
      toast.success('Pending payment cancelled. Slot released.');
      setTab('cancelled');
      consults.refetch();
      doctors.refetch(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not cancel pending payment');
    } finally {
      setCancellingPendingId(null);
    }
  };

  const cancelUpcomingConsultation = async (consultation) => {
    if (!consultation?.consultation_id) return;
    const okToCancel = window.confirm(
      'No refund will be issued if you cancel this paid consultation. Do you want to continue?',
    );
    if (!okToCancel) return;

    setCancellingId(consultation.consultation_id);
    try {
      await API.post(`/api/patient/consultations/${consultation.consultation_id}/cancel/`);
      toast.success('Consultation cancelled. No refund will be issued.');
      setTab('cancelled');
      consults.refetch();
      doctors.refetch(true);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not cancel consultation');
    } finally {
      setCancellingId(null);
    }
  };

  // Open the in-app consultation room (same Jitsi room as the doctor). The
  // consultation is passed via router state so the room has the room id + names
  // without a refetch; the room also fetches as a fallback on direct load.
  const handleJoinConsultation = (c) => {
    if (!c?.consultation_id) return;
    navigate(`/patient/consultation-room/${c.consultation_id}`, { state: { consultation: c } });
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* Header */}
        <motion.div variants={cardVariants} className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="font-bricolage text-3xl font-extrabold text-ink">Consultations</h1>
            <p className="text-muted mt-1">Book and manage your consultations</p>
          </div>
        </motion.div>

        {/* Booking flow */}
        <section className="mb-10">
          <StepIndicator steps={BOOK_STEPS} current={bookingStep} />

          {/* Search + filter pills */}
          <div className="mb-4">
            <div className="relative max-w-md mb-3">
              <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-orange-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doctors or specialization…"
                className="w-full bg-white border border-hairline rounded-full pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {specializations.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpecFilter(s)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium border transition ${
                    specFilter === s
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-muted border-hairline hover:border-orange-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {doctors.loading ? (
            <div className="dashboard-card text-sm text-muted">Loading doctors…</div>
          ) : filteredDoctors.length === 0 ? (
            <div className="dashboard-card text-sm text-muted text-center py-8">No doctors match your search.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDoctors.map((doc) => {
                const profileImage = doctorPhoto(doc);
                const bannerImage = departmentPhoto(doc);
                return (
                <motion.div
                  key={doc.doctor_id}
                  variants={cardVariants}
                  whileHover={cardHover}
                  className="rounded-2xl border border-hairline bg-white overflow-hidden hover:border-gray-300 transition-colors"
                >
                  <div className="h-20 bg-gray-100 relative overflow-visible">
                    {bannerImage ? (
                      <img
                        src={bannerImage}
                        alt={doc.dept_name || doc.specialization || 'Department'}
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gray-100" />
                    )}
                    <div className="absolute -bottom-6 left-5 w-14 h-14 rounded-2xl bg-white border-4 border-white shadow flex items-center justify-center overflow-hidden">
                      {profileImage ? (
                        <img
                          src={profileImage}
                          alt={withDr(doc.full_name)}
                          className="w-full h-full rounded-xl object-cover"
                        />
                      ) : (
                        <span className="w-full h-full rounded-xl bg-gray-900 text-white flex items-center justify-center font-bricolage font-extrabold text-lg">
                          {(doc.full_name || 'D').slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <span className="absolute top-3 right-3 inline-flex items-center gap-1.5 text-xs text-gray-800 bg-white/90 border border-white/70 rounded-full px-2 py-1 shadow-sm">
                      <span className={`w-2 h-2 rounded-full ${doc.is_online ? 'bg-green-400' : 'bg-gray-400'}`} />
                      {doc.is_online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="p-5 pt-8">
                    <div className="font-bricolage font-bold text-ink truncate">{withDr(doc.full_name)}</div>
                    <span className="inline-block mt-1 text-xs bg-orange-50 text-orange-600 px-2.5 py-0.5 rounded-full font-medium">
                      {doc.specialization}
                    </span>
                    {doc.dept_name && doc.dept_name !== doc.specialization && (
                      <div className="text-xs text-orange-500 mt-1 truncate">{doc.dept_name}</div>
                    )}
                    <div className="text-xs text-muted mt-1.5 truncate">{doc.hospital_name}</div>
                    <div className="flex items-center justify-between mt-4">
                      <div>
                        <div className="text-xs text-muted">Fee</div>
                        <div className="font-bricolage font-extrabold text-orange-500 text-lg">₹{doc.consultation_fee}</div>
                      </div>
                      <span className="text-xs text-muted bg-cream border border-hairline px-2.5 py-1 rounded-full">
                        {doc.available_slots_count} slots
                      </span>
                    </div>
                    <button
                      onClick={() => openSlots(doc)}
                      disabled={!doc.available_slots_count}
                      className="w-full mt-4 bg-ink text-white rounded-full py-2.5 text-sm font-semibold hover:bg-black/80 transition disabled:opacity-40"
                    >
                      {doc.available_slots_count ? 'Book Now' : 'No Slots'}
                    </button>
                  </div>
                </motion.div>
                );
              })}
            </div>
          )}
        </section>

        {/* My consultations */}
        <section>
          <h2 className="dash-h2">My Consultations</h2>
          <AnimatedTabs
            tabs={CONSULTATION_TABS.map((t) => ({ key: t.key, label: `${t.label} (${buckets[t.key].length})` }))}
            active={tab}
            onChange={setTab}
            layoutId="consult-tab"
          />

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {consults.loading ? (
                <div className="dashboard-card text-sm text-muted">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="dashboard-card text-center py-10 text-muted">
                  <FiCalendar className="w-8 h-8 mx-auto text-gray-300 mb-2" />
                  <div className="text-sm">No {TAB_LABELS[tab] || tab} consultations.</div>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map((c) => {
                    const statusPill = (() => {
                      if (tab === 'pending_payment') return { bg: 'bg-amber-100', color: 'text-amber-700', label: 'Pending Payment' };
                      if (tab === 'missed') return { bg: 'bg-red-100', color: 'text-red-700', label: '⚠️ Missed' };
                      if (tab === 'past') return { bg: 'bg-green-100', color: 'text-green-700', label: '✓ Completed' };
                      if (tab === 'cancelled') return { bg: 'bg-gray-100', color: 'text-gray-600', label: '✕ Cancelled' };
                      return { bg: 'bg-orange-100', color: 'text-orange-700', label: '📅 Upcoming' };
                    })();
                    const joinState = tab === 'upcoming' ? getJoinButtonStatus(c) : null;
                    const visibleStatusPill = {
                      ...statusPill,
                      label: TAB_LABELS[tab] || statusPill.label,
                    };
                    const holdRemaining = getHoldSecondsRemaining(c);

                    return (
                      <div
                        key={c.consultation_id}
                        className="bg-white rounded-2xl p-5 border border-gray-100 hover:shadow-md transition-shadow"
                      >
                        {/* Top: doctor + status pill */}
                        <div className="flex items-start justify-between mb-4 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0"
                              style={{ backgroundColor: '#F97316' }}
                            >
                              {(c.doctor_name || 'D').charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-bold text-black text-base truncate">{withDr(c.doctor_name)}</p>
                              <p className="text-sm text-gray-500 truncate">
                                {c.doctor_specialization || c.specialization || 'General'}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`text-xs px-3 py-1 rounded-full font-semibold whitespace-nowrap ${visibleStatusPill.bg} ${visibleStatusPill.color}`}
                          >
                            {visibleStatusPill.label}
                          </span>
                        </div>

                        {/* Date + time row */}
                        <div className="bg-gray-50 rounded-xl p-3 mb-4">
                          <div className="flex items-center gap-4 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400 text-sm">📅</span>
                              <div>
                                <p className="text-xs text-gray-400">Date</p>
                                <p className="font-semibold text-black text-sm">{fmtSlotDate(c.slot_date)}</p>
                              </div>
                            </div>
                            <div className="w-px h-8 bg-gray-200" />
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400 text-sm">🕐</span>
                              <div>
                                <p className="text-xs text-gray-400">Time</p>
                                <p className="font-semibold text-sm" style={{ color: '#F97316' }}>
                                  {c.start_time?.slice(0, 5)}{' - '}{c.end_time?.slice(0, 5)}
                                </p>
                              </div>
                            </div>
                            <span className="ml-auto text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                              {c.consult_type === 'online' ? '💻 Online' : '🏥 Physical'}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        {tab === 'upcoming' && (
                          <div className="flex gap-2 flex-wrap">
                            {c.consult_type === 'online' && c.jitsi_room_id && (
                              <button
                                onClick={() => joinState?.canJoin && handleJoinConsultation(c)}
                                disabled={!joinState?.canJoin}
                                className="flex-1 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-60"
                                style={{ backgroundColor: joinState?.canJoin ? '#F97316' : '#9CA3AF' }}
                              >
                                {joinState?.canJoin ? <span className="inline-flex items-center gap-1"><FiVideo className="w-3.5 h-3.5" /> Join Consultation</span> : joinState?.label || 'Not yet'}
                              </button>
                            )}
                            <button
                              onClick={() => setChatConsult(c)}
                              className="flex-1 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 inline-flex items-center justify-center gap-1"
                            >
                              <FiMessageCircle className="w-3.5 h-3.5" /> Chat
                            </button>
                            {c.can_cancel && (
                              <button
                                onClick={() => cancelUpcomingConsultation(c)}
                                disabled={cancellingId === c.consultation_id}
                                className="flex-1 py-2 rounded-full text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-60 inline-flex items-center justify-center gap-1"
                              >
                                <FiXCircle className="w-3.5 h-3.5" />
                                {cancellingId === c.consultation_id ? 'Cancelling...' : 'Cancel'}
                              </button>
                            )}
                            {c.can_cancel && (
                              <p className="w-full text-xs text-red-600 flex items-center gap-1">
                                <FiAlertTriangle className="w-3.5 h-3.5" /> No refund if cancelled.
                              </p>
                            )}
                          </div>
                        )}

                        {tab === 'pending_payment' && (
                          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Payment hold</p>
                                <p className="text-sm text-gray-700 mt-1">
                                  Slot reserved for {formatRemaining(holdRemaining)} more.
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => payPendingConsultation(c)}
                                  disabled={payingPending === c.consultation_id || holdRemaining <= 0}
                                  className="px-4 py-2 rounded-full text-sm font-semibold bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-60 inline-flex items-center gap-1.5"
                                >
                                  <FiCreditCard className="w-4 h-4" />
                                  {payingPending === c.consultation_id ? 'Opening...' : 'Pay Now'}
                                </button>
                                <button
                                  onClick={() => cancelPendingPayment(c)}
                                  disabled={cancellingPendingId === c.consultation_id}
                                  className="px-4 py-2 rounded-full text-sm font-semibold bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:opacity-60 inline-flex items-center gap-1.5"
                                >
                                  <FiXCircle className="w-4 h-4" />
                                  {cancellingPendingId === c.consultation_id ? 'Cancelling...' : 'Cancel'}
                                </button>
                              </div>
                            </div>
                            <p className="text-xs text-amber-700 mt-2">
                              If payment is not completed in 10 minutes, this slot becomes available to other patients.
                            </p>
                          </div>
                        )}

                        {['paid', 'refunded'].includes(c.payment_status) && (
                          <button
                            type="button"
                            onClick={() => downloadBillPdf(
                              `/api/patient/consultations/${c.consultation_id}/bill/`,
                              `consultation-bill-${String(c.consultation_id || '').slice(0, 8)}.pdf`,
                            )}
                            className="mt-3 w-full sm:w-auto px-4 py-2 rounded-full text-sm font-semibold border-2 inline-flex items-center justify-center gap-1.5"
                            style={{ borderColor: '#F97316', color: '#F97316', backgroundColor: '#FFFFFF' }}
                          >
                            <FiDownload className="w-4 h-4" />
                            Download Bill
                          </button>
                        )}

                        {tab === 'missed' && (
                          <button
                            onClick={() => {
                              // Re-open booking for the same doctor by jumping the
                              // user to the doctor list; the existing slot picker
                              // handles the rest.
                              const doc = doctorList.find((d) => d.full_name === c.doctor_name);
                              if (doc) openSlots(doc);
                              else navigate('/patient/consultations');
                            }}
                            className="w-full py-2 rounded-full text-sm font-semibold text-white"
                            style={{ backgroundColor: '#F97316' }}
                          >
                            Book Again
                          </button>
                        )}

                        {tab === 'past' && (
                          <div className="flex gap-2 flex-wrap items-center">
                            <span className="text-xs text-gray-500">Payment: {c.payment_status}</span>
                            <button
                              onClick={() => {
                                const doc = doctorList.find((d) => d.full_name === c.doctor_name);
                                if (doc) openSlots(doc);
                              }}
                              className="ml-auto py-2 px-4 rounded-full text-sm font-semibold text-white"
                              style={{ backgroundColor: '#000000' }}
                            >
                              Book Again
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </motion.div>

      {/* Slot picker modal */}
      <Modal
        isOpen={Boolean(slotDoctor)}
        onClose={() => {
          setSlotDoctor(null);
          setSelectedBookingSlot(null);
        }}
        title={(
          <span className="inline-flex items-center gap-2 text-ink">
            <FiShoppingCart className="w-5 h-5 text-orange-500" /> Your Booking
          </span>
        )}
        size="sm"
      >
        {slotsLoading ? (
          <div className="py-10 text-center text-sm text-muted">Loading slots...</div>
        ) : availableSlots.length === 0 ? (
          <div className="py-10 text-center">
            <FiCalendar className="w-10 h-10 mx-auto text-gray-300 mb-3" />
            <p className="text-sm text-muted">No open slots for this doctor.</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center py-2">
              <FiCalendar className="w-10 h-10 mx-auto text-gray-300 mb-2" />
              <p className="text-gray-400">
                {selectedBookingSlot ? 'Slot selected.' : 'No slot selected yet.'}
              </p>
              <p className="text-sm text-gray-400">
                {selectedBookingSlot
                  ? `${fmtSlotDate(selectedBookingSlot.slot_date)} at ${selectedBookingSlot.start_display || selectedBookingSlot.start_time}`
                  : 'Select a time slot from the list'}
              </p>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-2">Hospital</label>
              <select
                value={slotDoctor?.hospital_name || ''}
                disabled
                className="w-full h-12 rounded-2xl border border-gray-200 bg-white px-4 text-sm text-ink focus:outline-none"
              >
                <option value={slotDoctor?.hospital_name || ''}>{slotDoctor?.hospital_name || 'Hospital'}</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-2">Date</label>
              <div className="relative">
                <input
                  type="date"
                  value={selectedSlotDate}
                  min={toDateInputValue()}
                  onChange={(e) => setSelectedSlotDate(e.target.value)}
                  className="w-full h-[52px] rounded-2xl border border-orange-500 bg-white px-4 pr-11 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-orange-100"
                />
                <FiCalendar className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
              </div>
              <p className="mt-2 text-xs text-orange-500 flex items-center gap-1">
                <FiAlertTriangle className="w-3.5 h-3.5" /> Only future time slots are shown for today
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-600 mb-2">Time slot</p>
              {selectedDateSlots.length === 0 ? (
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-5 text-center text-sm text-gray-500">
                  No slots available for this date.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                  {selectedDateSlots.map((slot) => {
                    const isSelected = selectedBookingSlot?.slot_id === slot.slot_id;
                    return (
                      <button
                        key={slot.slot_id}
                        onClick={() => setSelectedBookingSlot(slot)}
                        disabled={booking}
                        className={`min-h-[52px] rounded-2xl border px-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-100 transition disabled:opacity-60 ${
                          isSelected
                            ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-[0_0_0_1px_rgba(249,115,22,0.22)]'
                            : 'border-gray-200 bg-white text-ink hover:border-orange-500 hover:bg-orange-50'
                        }`}
                      >
                        {slot.start_display || slot.start_time}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-orange-50 border border-orange-100 px-4 py-3 text-sm">
              <div className="font-semibold text-ink">{withDr(slotDoctor?.full_name)}</div>
              <div className="text-gray-500 mt-1">
                {selectedDateSlots[0] ? `${typeLabel(selectedDateSlots[0].consult_type)} · ₹${selectedDateSlots[0].consultation_fee}` : 'Choose a time'}
              </div>
            </div>

            <button
              onClick={() => bookSlot(selectedBookingSlot)}
              disabled={!selectedBookingSlot || booking}
              className="w-full h-12 rounded-full bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500 transition-colors"
            >
              {booking ? 'Booking...' : 'Book Slot'}
            </button>
          </div>
        )}
      </Modal>

      {/* Confirmation modal */}
      <Modal isOpen={Boolean(confirmation)} onClose={() => setConfirmation(null)} title="Consultation Confirmed">
        {confirmation && (
          <div className="space-y-3 text-sm">
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
              <div className="text-4xl mb-1">✅</div>
              <div className="font-bricolage font-bold text-green-700 mb-1">Booking confirmed</div>
              <div className="text-ink">
                {withDr(confirmation.doctor_name)} · {confirmation.slot_date} {confirmation.slot_time}
              </div>
            </div>
            <p className="text-muted">A confirmation email with the video link has been sent to you.</p>
            <button
              onClick={() => {
                setConfirmation(null);
                setTab('upcoming');
                consults.refetch();
              }}
              className="btn-orange w-full"
            >
              <FiUser className="w-4 h-4" /> Consultation
            </button>
          </div>
        )}
      </Modal>

      {/* Consultation chat modal */}
      <Modal
        isOpen={Boolean(chatConsult)}
        onClose={() => setChatConsult(null)}
        title={chatConsult ? `Chat — Dr. ${chatConsult.doctor_name}` : ''}
      >
        {chatConsult && (
          <ConsultationChat
            consultationId={chatConsult.consultation_id}
            sender="patient"
            senderName={user?.full_name || 'Patient'}
          />
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default ConsultationsPage;
