import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { FiSearch } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import Badge from '../../components/common/Badge';
import RazorpayButton from '../../components/payment/RazorpayButton';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import { cleanDoctorName } from '../../utils/nameUtils';

const BookDoctor = () => {
  const doctors = useApi('/api/patient/doctors/');
  const [search, setSearch] = useState('');
  const [hospitalFilter, setHospitalFilter] = useState('');
  const [activeDoctor, setActiveDoctor] = useState(null);   // doctor object for modal
  const [slots, setSlots] = useState({ loading: false, items: [] });
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [consultType, setConsultType] = useState('online');
  const [booking, setBooking] = useState(null);             // { consultation_id, amount } after booking
  const [submitting, setSubmitting] = useState(false);

  const list = useMemo(() => doctors.data?.doctors || [], [doctors.data]);
  const hospitals = useMemo(() => {
    const seen = new Map();
    list.forEach((d) => { if (!seen.has(d.hospital_id)) seen.set(d.hospital_id, d.hospital_name); });
    return Array.from(seen, ([id, name]) => ({ id, name }));
  }, [list]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((d) => {
      if (hospitalFilter && d.hospital_id !== hospitalFilter) return false;
      if (!q) return true;
      return (
        d.full_name.toLowerCase().includes(q) ||
        d.specialization.toLowerCase().includes(q)
      );
    });
  }, [list, search, hospitalFilter]);

  const openDoctor = async (d) => {
    setActiveDoctor(d);
    setSelectedSlot(null);
    setBooking(null);
    setSlots({ loading: true, items: [] });
    try {
      const { data } = await API.get(`/api/patient/doctor-slots/${d.doctor_id}/`);
      setSlots({ loading: false, items: data?.data?.slots || [] });
    } catch (err) {
      setSlots({ loading: false, items: [] });
      toast.error('Could not load slots');
    }
  };

  const closeModal = () => {
    setActiveDoctor(null);
    setSelectedSlot(null);
    setBooking(null);
  };

  const proceedToBook = async () => {
    if (!selectedSlot) return toast.error('Select a slot');
    setSubmitting(true);
    try {
      const { data } = await API.post('/api/patient/book-consultation/', {
        doctor_id: activeDoctor.doctor_id,
        slot_id: selectedSlot.slot_id,
        consult_type: consultType,
      });
      const d = data?.data || {};
      setBooking({
        consultation_id: d.consultation_id,
        amount: d.amount || 0,
        doctor_name: d.doctor_name,
        slot_date: d.slot_date,
        slot_time: d.slot_time,
      });
      toast.success('Consultation booked. Complete payment to confirm.');
      doctors.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Booking failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onPaymentSuccess = () => {
    toast.success('Consultation confirmed!');
    closeModal();
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-500">Book a Doctor</h1>
        <p className="text-sm text-gray-500">Browse available specialists and book a slot.</p>
      </div>

      {/* Filter bar */}
      <div className="card mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="relative sm:col-span-2">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or specialization…"
            className="input-field pl-10"
          />
        </div>
        <select value={hospitalFilter} onChange={(e) => setHospitalFilter(e.target.value)} className="input-field">
          <option value="">All hospitals</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>{h.name}</option>
          ))}
        </select>
      </div>

      {/* Doctor grid */}
      {doctors.loading ? (
        <div className="card text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center text-gray-500 py-8">No doctors found.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <div key={d.doctor_id} className="card flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-primary-500 truncate">{cleanDoctorName(d.full_name)}</div>
                  <div className="text-xs text-gray-500 truncate">{d.hospital_name}</div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${d.is_online ? 'bg-success' : 'bg-gray-400'}`} />
                  {d.is_online ? 'Online' : 'Offline'}
                </span>
              </div>
              <Badge status="info" text={d.specialization} />
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Fee</div>
                  <div className="font-semibold text-gray-700">₹{d.consultation_fee}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Available</div>
                  <div className="font-semibold text-gray-700">{d.available_slots_count} slots</div>
                </div>
              </div>
              <button
                onClick={() => openDoctor(d)}
                disabled={d.available_slots_count === 0}
                className="btn-primary mt-4 disabled:opacity-50"
              >
                {d.available_slots_count === 0 ? 'No Slots' : 'Book Appointment'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Booking Modal */}
      <Modal isOpen={Boolean(activeDoctor)} onClose={closeModal} title={`Book Dr. ${activeDoctor?.full_name || ''}`} size="lg">
        {activeDoctor && (
          <div className="space-y-4">
            {!booking ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-gray-500">Specialization</div>
                    <div className="font-medium">{activeDoctor.specialization}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Fee</div>
                    <div className="font-medium">₹{activeDoctor.consultation_fee}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase text-gray-500 mb-2">Available slots</div>
                  {slots.loading ? (
                    <p className="text-sm text-gray-500">Loading…</p>
                  ) : slots.items.length === 0 ? (
                    <p className="text-sm text-gray-500">No open slots.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                      {slots.items.map((s) => {
                        const sel = selectedSlot?.slot_id === s.slot_id;
                        return (
                          <button
                            key={s.slot_id}
                            onClick={() => setSelectedSlot(s)}
                            className={`p-3 rounded-xl border-2 text-left text-sm transition ${
                              sel
                                ? 'border-primary-500 bg-primary-50 text-primary-600'
                                : 'border-gray-200 hover:border-primary-300'
                            }`}
                          >
                            <div className="font-semibold">{s.slot_date}</div>
                            <div className="text-xs text-gray-500">{s.start_time}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{s.consult_type}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs uppercase text-gray-500 mb-2">Consultation type</div>
                  <div className="flex gap-2">
                    {['online', 'in_person'].map((t) => (
                      <button
                        key={t}
                        onClick={() => setConsultType(t)}
                        className={`px-4 py-2 rounded-xl text-sm border-2 transition ${
                          consultType === t
                            ? 'border-primary-500 bg-primary-50 text-primary-600'
                            : 'border-gray-200 text-gray-600 hover:border-primary-300'
                        }`}
                      >
                        {t === 'online' ? 'Online (Jitsi)' : 'In Person'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={closeModal} className="btn-secondary">Cancel</button>
                  <button onClick={proceedToBook} disabled={submitting || !selectedSlot} className="btn-primary disabled:opacity-60">
                    {submitting ? 'Booking…' : 'Proceed to Payment'}
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="bg-primary-50 border border-primary-100 rounded-xl p-4 text-sm">
                  <div className="font-semibold text-primary-500 mb-1">Slot reserved</div>
                  <div>{cleanDoctorName(booking.doctor_name)}</div>
                  <div className="text-gray-500">{booking.slot_date} · {booking.slot_time}</div>
                  <div className="mt-2 text-lg font-bold text-primary-500">₹{booking.amount}</div>
                </div>
                {booking.amount > 0 ? (
                  <RazorpayButton
                    amount={booking.amount}
                    payment_type="consultation"
                    object_id={booking.consultation_id}
                    description={`Consultation with Dr. ${booking.doctor_name}`}
                    buttonText="Pay & Confirm"
                    className="w-full"
                    onSuccess={onPaymentSuccess}
                  />
                ) : (
                  <button onClick={onPaymentSuccess} className="btn-primary w-full">Confirm Booking (Free)</button>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default BookDoctor;
