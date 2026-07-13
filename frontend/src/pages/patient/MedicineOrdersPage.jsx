import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiDownload, FiUpload } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { openRazorpay } from '../../utils/payment';
import { downloadBillPdf } from '../../utils/pdf';

// Map raw backend statuses → simplified buckets used by the tab UI and the
// progress tracker. Backend uses a richer set (prescription_uploaded etc.) so
// we collapse the in-flight ones to 'processing' for display.
const simplifyStatus = (s) => {
  if (!s) return 'pending';
  if (s === 'cancelled' || s === 'delivered' || s === 'dispatched') return s;
  if (s === 'pending' || s === 'awaiting_prescription' || s === 'prescription_required') return 'pending';
  if (s === 'resolved') return 'delivered';
  if (s === 'wrong_product') return 'processing';
  if (s === 'refunded') return 'cancelled';
  return 'processing'; // confirmed, prescription_uploaded/approved, verified, payment_pending
};

const STATUS_BADGE = {
  delivered:  { cls: 'bg-green-100 text-green-700',   label: '✓ Delivered' },
  dispatched: { cls: 'bg-blue-100 text-blue-700',     label: '🚚 Dispatched' },
  processing: { cls: 'bg-orange-100 text-orange-700', label: '⚙️ Processing' },
  wrong_product: { cls: 'bg-red-100 text-red-700',    label: '⚠️ Issue Reported' },
  refunded:   { cls: 'bg-red-100 text-red-800',       label: '💸 Refunded' },
  cancelled:  { cls: 'bg-red-100 text-red-700',       label: '✕ Cancelled' },
  pending:    { cls: 'bg-yellow-100 text-yellow-700', label: '⏳ Pending' },
};

const TABS = [
  { key: 'all',        label: 'All Orders' },
  { key: 'pending',    label: '⏳ Pending' },
  { key: 'processing', label: '⚙️ Processing' },
  { key: 'dispatched', label: '🚚 Dispatched' },
  { key: 'delivered',  label: '✓ Delivered' },
  { key: 'cancelled',  label: '✕ Cancelled' },
];

const PROGRESS_STEPS = ['pending', 'processing', 'dispatched', 'delivered'];

const fmtDate = (iso) => {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return 'N/A'; }
};

const summariseMedicines = (meds) => {
  if (!Array.isArray(meds) || meds.length === 0) return 'Medicine Order';
  const first = meds[0]?.name || meds[0]?.medicine_name || 'Medicine';
  if (meds.length === 1) return first;
  return `${first} + ${meds.length - 1} more`;
};

const totalUnits = (meds) =>
  (Array.isArray(meds) ? meds : []).reduce((s, m) => s + Number(m.qty || m.quantity || 1), 0);

// Live 10-minute countdown for a stock reservation. Fires onExpired once when
// it hits zero (the parent then refetches, which triggers the server-side
// release + cancellation).
const ReservationTimer = ({ expiresAt, onExpired }) => {
  const [label, setLabel] = useState('');
  const [expired, setExpired] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      const diff = new Date(expiresAt) - new Date();
      if (diff <= 0) {
        setExpired(true);
        setLabel('Reservation expired');
        if (!firedRef.current) { firedRef.current = true; onExpired?.(); }
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setLabel(`⏰ Pay within ${mins}:${String(secs).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt, onExpired]);

  return (
    <div className="rounded-xl px-3 py-2 mb-2" style={{ backgroundColor: expired ? '#FEF2F2' : '#FFF7ED' }}>
      <p className="text-sm font-bold" style={{ color: expired ? '#EF4444' : '#F97316' }}>
        {expired ? '❌ Reservation expired — stock released' : label}
      </p>
      {!expired && (
        <p className="text-[11px] text-gray-500">Complete payment to confirm your order</p>
      )}
    </div>
  );
};

const MedicineOrdersPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');

  // Per-order action state — prescription re-upload, payment, OTP confirmation.
  const [rxFiles, setRxFiles] = useState({});
  const [uploadingId, setUploadingId] = useState(null);
  const [otpOrder, setOtpOrder] = useState(null);
  const [otp, setOtp] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reportingIssue, setReportingIssue] = useState(false);
  const [issueType, setIssueType] = useState('Wrong medicine');
  const [desiredResolution, setDesiredResolution] = useState('refund');

  const fetchOrders = useCallback(async () => {
    try {
      const res = await API.get('/api/patient/medicine/orders/');
      if (res.data?.success) setOrders(res.data.data?.orders || []);
    } catch (e) {
      /* best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const payNow = (order) => {
    if (!order.razorpay_order_id || !order.razorpay_key_id) {
      return toast.error('Payment is not ready yet. Please refresh.');
    }
    openRazorpay({
      orderId: order.razorpay_order_id,
      amount: order.razorpay_amount,
      keyId: order.razorpay_key_id,
      paymentType: 'medicine',
      objectId: order.order_id,
      user,
      description: 'Medicine order',
      onSuccess: () => {
        toast.success('Payment successful!');
        fetchOrders();
      },
    });
  };

  const uploadPrescription = async (orderId) => {
    const file = rxFiles[orderId];
    if (!file) return toast.error('Choose a prescription file first');
    setUploadingId(orderId);
    try {
      const fd = new FormData();
      fd.append('order_id', orderId);
      fd.append('prescription', file);
      await API.post('/api/patient/medicine/upload-prescription/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Prescription uploaded! Waiting for pharmacist approval.');
      setRxFiles((cur) => ({ ...cur, [orderId]: null }));
      fetchOrders();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Upload failed');
    } finally {
      setUploadingId(null);
    }
  };

  const confirmDelivery = async () => {
    if (!otpOrder || otp.length !== 6) return toast.error('Enter the 6-digit OTP');
    setConfirming(true);
    try {
      await API.post('/api/patient/medicine/confirm-delivery/', { order_id: otpOrder.order_id, otp });
      toast.success('Delivery confirmed ✅');
      setOtpOrder(null);
      setOtp('');
      fetchOrders();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Invalid or expired OTP');
    } finally {
      setConfirming(false);
    }
  };

  const reportIssue = async () => {
    if (!otpOrder) return;
    setConfirming(true);
    try {
      await API.post(`/api/pharmacy/orders/${otpOrder.order_id}/report-issue/`, {
        issue_type: issueType,
        desired_resolution: desiredResolution
      });
      toast.success('Issue reported! The pharmacist will contact you soon.');
      setOtpOrder(null);
      setReportingIssue(false);
      fetchOrders();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to report issue');
    } finally {
      setConfirming(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (activeTab === 'all') return orders;
    return orders.filter((o) => simplifyStatus(o.status) === activeTab);
  }, [orders, activeTab]);

  const tabCount = (key) => {
    if (key === 'all') return orders.length;
    return orders.filter((o) => simplifyStatus(o.status) === key).length;
  };

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-black">💊 Medicine Orders</h1>
            <p className="text-gray-500 text-sm mt-1">Track all your medicine orders</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/patient/medicine')}
            className="px-4 py-2 rounded-full text-sm font-semibold text-white"
            style={{ backgroundColor: '#F97316' }}
          >
            + New Order
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all"
                style={{
                  backgroundColor: active ? '#F97316' : '#FFFFFF',
                  color: active ? '#FFFFFF' : '#000000',
                  border: active ? 'none' : '1px solid #E5E5E5',
                }}
              >
                {tab.label}
                <span className="ml-1">({tabCount(tab.key)})</span>
              </button>
            );
          })}
        </div>

        {/* List */}
        {loading ? (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
            <p className="text-5xl mb-4">💊</p>
            <p className="font-semibold text-gray-700 mb-2">No orders found</p>
            <button
              type="button"
              onClick={() => navigate('/patient/medicine')}
              className="mt-3 px-6 py-2 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: '#F97316' }}
            >
              Order Medicines
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOrders.map((order) => {
              const simple = simplifyStatus(order.status);
              const badge = STATUS_BADGE[simple] || STATUS_BADGE.pending;
              const currentIndex = PROGRESS_STEPS.indexOf(simple);

              return (
                <motion.div
                  key={order.order_id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="bg-white rounded-2xl p-5 border border-gray-100"
                >
                  {/* Top row */}
                  <div className="flex items-start justify-between mb-3 gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-black truncate">
                        {summariseMedicines(order.medicines)}
                      </p>
                      <p className="text-sm text-gray-500 truncate">
                        Order #{String(order.order_id || '').slice(0, 8).toUpperCase()}
                        {order.pharmacy_name ? ` · ${order.pharmacy_name}` : ''}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-3 py-1 rounded-full font-semibold whitespace-nowrap ${badge.cls}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Details grid */}
                  <div className="grid grid-cols-3 gap-3 bg-gray-50 rounded-xl p-3 mb-3">
                    <div>
                      <p className="text-xs text-gray-400">Items</p>
                      <p className="font-semibold text-sm text-black">
                        {(order.medicines_count ?? (order.medicines || []).length) || 0} item
                        {(order.medicines_count ?? (order.medicines || []).length) === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {totalUnits(order.medicines)} units
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Amount</p>
                      <p className="font-semibold text-sm" style={{ color: '#F97316' }}>
                        ₹{Number(order.total_amount || 0).toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 capitalize">
                        {order.payment_status || 'pending'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Ordered On</p>
                      <p className="font-semibold text-sm text-black">
                        {fmtDate(order.ordered_at)}
                      </p>
                    </div>
                  </div>

                  {/* Progress tracker */}
                  {simple !== 'cancelled' && (
                    <div className="flex items-center gap-2">
                      {PROGRESS_STEPS.map((step, i) => {
                        const isDone = i <= currentIndex;
                        return (
                          <div key={step} className="flex items-center flex-1">
                            <div
                              className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold"
                              style={{
                                backgroundColor: isDone ? '#F97316' : '#E5E5E5',
                                color: isDone ? '#fff' : '#999',
                              }}
                              title={step}
                            >
                              {isDone ? '✓' : i + 1}
                            </div>
                            {i < PROGRESS_STEPS.length - 1 && (
                              <div
                                className="flex-1 h-0.5 mx-1"
                                style={{
                                  backgroundColor: i < currentIndex ? '#F97316' : '#E5E5E5',
                                }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Actions ─────────────────────────────────────── */}

                  {/* Re-upload prescription for orders still awaiting one */}
                  {order.status === 'awaiting_prescription' && (
                    <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                      <p className="text-sm font-medium mb-2" style={{ color: '#F97316' }}>
                        ⚠️ Upload your prescription to proceed
                      </p>
                      <label className="border-2 border-dashed rounded-xl p-3 text-center cursor-pointer block" style={{ borderColor: '#FDBA74' }}>
                        <span className="text-2xl">📄</span>
                        <p className="text-xs mt-1 text-gray-600">
                          {rxFiles[order.order_id]?.name || 'Choose prescription (JPG, PNG, PDF)'}
                        </p>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          className="hidden"
                          onChange={(e) => setRxFiles((cur) => ({ ...cur, [order.order_id]: e.target.files?.[0] || null }))}
                        />
                      </label>
                      {rxFiles[order.order_id] && (
                        <button
                          type="button"
                          onClick={() => uploadPrescription(order.order_id)}
                          disabled={uploadingId === order.order_id}
                          className="w-full mt-2 px-4 py-2 rounded-full text-sm font-medium text-white inline-flex items-center justify-center gap-1 disabled:opacity-60"
                          style={{ backgroundColor: '#F97316' }}
                        >
                          <FiUpload className="w-4 h-4" />
                          {uploadingId === order.order_id ? 'Uploading…' : 'Upload Prescription'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Waiting for pharmacist verification */}
                  {order.status === 'prescription_uploaded' && (
                    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
                      <p className="text-sm text-blue-700 font-medium">⏳ Prescription uploaded</p>
                      <p className="text-xs text-blue-600">Waiting for the pharmacist to verify. You will be notified when approved.</p>
                    </div>
                  )}

                  {/* Reservation countdown for unpaid, freshly-reserved orders */}
                  {order.status === 'payment_pending'
                    && order.payment_status !== 'paid'
                    && order.reservation_expires_at && (
                    <ReservationTimer
                      expiresAt={order.reservation_expires_at}
                      onExpired={fetchOrders}
                    />
                  )}

                  {/* Pay now — prescription approved or payment still pending */}
                  {((order.status === 'prescription_approved')
                    || (order.status === 'payment_pending' && order.payment_status !== 'paid')) && (
                    <div className="mt-3 bg-green-50 border border-green-200 rounded-xl p-3">
                      <p className="text-sm font-medium text-green-700 mb-2">
                        {order.status === 'prescription_approved'
                          ? '✅ Prescription Approved! Complete payment to confirm your order.'
                          : 'Complete payment to confirm your order.'}
                      </p>
                      <button
                        type="button"
                        onClick={() => payNow(order)}
                        className="px-4 py-2 rounded-full text-sm font-medium text-white"
                        style={{ backgroundColor: '#F97316' }}
                      >
                        Pay ₹{Number(order.total_amount || 0).toLocaleString('en-IN')} Now
                      </button>
                    </div>
                  )}

                  {['paid', 'refunded'].includes(order.payment_status) && (
                    <button
                      type="button"
                      onClick={() => downloadBillPdf(
                        `/api/patient/medicine/orders/${order.order_id}/bill/`,
                        `medicine-bill-${String(order.order_id || '').slice(0, 8)}.pdf`,
                      )}
                      className="mt-3 px-4 py-2 rounded-full text-sm font-semibold border-2 inline-flex items-center justify-center gap-1.5 w-full sm:w-auto"
                      style={{ borderColor: '#F97316', color: '#F97316', backgroundColor: '#FFFFFF' }}
                    >
                      <FiDownload className="w-4 h-4" />
                      Download Bill
                    </button>
                  )}

                  {/* Cancelled / rejected with reason */}
                  {order.status === 'cancelled' && order.prescription_rejection_reason && (
                    <div
                      className="mt-3 rounded-xl px-4 py-3"
                      style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5' }}
                    >
                      <p className="text-xs font-bold flex items-center gap-1.5 m-0" style={{ color: '#EF4444' }}>
                        ❌ Order Rejected
                      </p>
                      <p className="text-[13px] mt-1 m-0" style={{ color: '#666', lineHeight: 1.5 }}>
                        <span className="font-semibold" style={{ color: '#333' }}>Reason:</span>{' '}
                        {order.prescription_rejection_reason}
                      </p>
                      <p className="text-[11px] mt-1.5 m-0" style={{ color: '#9CA3AF' }}>
                        Contact the pharmacy for more info.
                      </p>
                    </div>
                  )}

                  {/* Dispatched — confirm receipt with OTP */}
                  {order.status === 'dispatched' && (
                    <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
                      <p className="text-sm text-gray-700 mb-2">
                        🚚 On the way! Check your email for the delivery OTP.
                      </p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => { setOtpOrder(order); setOtp(''); setReportingIssue(false); }}
                          className="px-4 py-2 rounded-full text-sm font-medium text-white flex-1"
                          style={{ backgroundColor: '#F97316' }}
                        >
                          Confirm Receipt
                        </button>
                        <button
                          type="button"
                          onClick={() => { setOtpOrder(order); setReportingIssue(true); }}
                          className="px-4 py-2 rounded-full text-sm font-medium text-red-600 bg-red-50 border border-red-200 whitespace-nowrap"
                        >
                          Wrong Product?
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* OTP delivery-confirmation modal */}
      <Modal isOpen={Boolean(otpOrder)} onClose={() => { setOtpOrder(null); setReportingIssue(false); }} title={reportingIssue ? "Report Issue" : "Confirm Delivery"}>
        <div className="space-y-3">
          {reportingIssue ? (
            <>
              <p className="text-sm text-gray-500">
                Did you receive the wrong product? Please select the issue below, and the pharmacist will resolve it.
              </p>
              <select
                className="w-full border rounded-xl px-4 py-3 focus:outline-none"
                style={{ borderColor: '#E5E5E5' }}
                value={issueType}
                onChange={(e) => setIssueType(e.target.value)}
              >
                <option value="Wrong medicine">Wrong medicine delivered</option>
                <option value="Missing items">Missing items</option>
                <option value="Damaged products">Damaged products</option>
              </select>
              <label className="text-xs text-gray-500 mt-2 block">What would you like us to do?</label>
              <select
                className="w-full border rounded-xl px-4 py-3 focus:outline-none"
                style={{ borderColor: '#E5E5E5' }}
                value={desiredResolution}
                onChange={(e) => setDesiredResolution(e.target.value)}
              >
                <option value="refund">I want a Refund</option>
                <option value="redeliver">I want the correct items (Redeliver)</option>
              </select>
              <button
                type="button"
                onClick={reportIssue}
                disabled={confirming}
                className="w-full px-4 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#EF4444' }}
              >
                {confirming ? 'Submitting…' : 'Submit Complaint'}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-500">
                Enter the 6-digit OTP sent to your email to confirm you received the medicines.
              </p>
              <input
                className="w-full text-center text-lg tracking-[0.4em] font-mono border rounded-xl px-4 py-3 focus:outline-none"
                style={{ borderColor: '#E5E5E5' }}
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="------"
              />
              <button
                type="button"
                onClick={confirmDelivery}
                disabled={confirming}
                className="w-full px-4 py-2 rounded-full text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#F97316' }}
              >
                {confirming ? 'Confirming…' : 'Confirm Delivery'}
              </button>
            </>
          )}
        </div>
      </Modal>
    </DashboardLayout>
  );
};

export default MedicineOrdersPage;
