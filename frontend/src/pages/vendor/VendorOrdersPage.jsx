import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FiRefreshCw, FiTruck, FiMessageCircle, FiSearch,
} from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants } from '../../components/dashboard/variants';
import Modal from '../../components/common/Modal';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { colorFor, initials, STATUS_LABEL } from './vendorHelpers';
import './vendor-design.css';

const STATUS_TABS = ['all', 'pending', 'confirmed', 'dispatched', 'delivered'];

const PAY_PILL = {
  paid: { bg: 'var(--v-green-soft)', color: '#1B5C39' },
  pending: { bg: 'var(--v-amber-soft)', color: '#6F4912' },
  failed: { bg: 'var(--v-red-soft)', color: '#7A2317' },
};

const VendorOrdersPage = () => {
  const { data: ordersRaw, refetch } = useApi('/api/vendor/orders/');
  const orders = Array.isArray(ordersRaw) ? ordersRaw : [];

  const [statusTab, setStatusTab] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);

  const [dispatchModal, setDispatchModal] = useState(null);
  const [dispatchForm, setDispatchForm] = useState({ estimated_delivery_days: 3, tracking_info: '' });
  const [dispatching, setDispatching] = useState(false);

  const [resendModal, setResendModal] = useState(null);
  const [resendDays, setResendDays] = useState(3);
  const [resending, setResending] = useState(false);

  const [openingChat, setOpeningChat] = useState(null);

  const counts = useMemo(() => {
    const c = { all: orders.length };
    orders.forEach((o) => { c[o.order_status] = (c[o.order_status] || 0) + 1; });
    return c;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      const tabOk = statusTab === 'all' || o.order_status === statusTab;
      const qOk = !q
        || o.hospital_name?.toLowerCase().includes(q)
        || o.product_name?.toLowerCase().includes(q)
        || String(o.eq_order_id || '').toLowerCase().includes(q);
      return tabOk && qOk;
    });
  }, [orders, statusTab, search]);

  const totalAmount = filtered.reduce((s, o) => s + Number(o.total_price || 0), 0);

  const openChatWithHospital = async (order) => {
    setOpeningChat(order.eq_order_id);
    try {
      const r = await API.post('/api/vendor/chat/get-or-create/', {
        hospital_id: order.hospital_id,
        order_id: order.eq_order_id,
      });
      if (r.data?.success) {
        toast.success('Chat opened — see Messages.');
        window.location.href = '/vendor/messages';
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to open chat.');
    } finally {
      setOpeningChat(null);
    }
  };

  const confirmOrder = async (orderId) => {
    setConfirmingId(orderId);
    try {
      await API.put(`/api/vendor/orders/${orderId}/status/`, { order_status: 'confirmed' });
      toast.success('Order confirmed');
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not confirm order');
    } finally {
      setConfirmingId(null);
    }
  };

  const openDispatch = (order) => {
    setDispatchForm({ estimated_delivery_days: 3, tracking_info: '' });
    setDispatchModal(order);
  };

  const handleDispatch = async () => {
    if (!dispatchModal) return;
    setDispatching(true);
    try {
      const r = await API.put(`/api/vendor/orders/${dispatchModal.eq_order_id}/dispatch/`, {
        estimated_delivery_days: Number(dispatchForm.estimated_delivery_days),
        tracking_info: dispatchForm.tracking_info,
      });
      toast.success(r.data?.message || 'Dispatched! OTP sent.');
      setDispatchModal(null);
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  const openResend = (order) => {
    setResendDays(order.estimated_delivery_days || 3);
    setResendModal(order);
  };

  const handleResendOTP = async () => {
    if (!resendModal) return;
    setResending(true);
    try {
      await API.post(`/api/vendor/orders/${resendModal.eq_order_id}/resend-otp/`, {
        estimated_delivery_days: Number(resendDays),
      });
      toast.success('New OTP sent to hospital email!');
      setResendModal(null);
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Resend failed');
    } finally {
      setResending(false);
    }
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible" className="v-scope v-page">
        <div className="v-page-head">
          <div>
            <h1 className="v-page-title">Orders</h1>
            <p className="v-page-sub">
              {filtered.length} order{filtered.length === 1 ? '' : 's'} · ₹{totalAmount.toLocaleString('en-IN')} GMV
            </p>
          </div>
          <div className="v-page-actions">
            <button type="button" onClick={refetch} className="v-btn-ghost">
              <FiRefreshCw style={{ width: 14, height: 14 }} /> Refresh
            </button>
          </div>
        </div>

        <div className="v-toolbar">
          <div className="v-chip-row">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                type="button"
                className={`v-chip${statusTab === t ? ' active' : ''}`}
                onClick={() => setStatusTab(t)}
              >
                {t === 'all' ? 'All' : STATUS_LABEL[t]}
                <span className="count">{counts[t] || 0}</span>
              </button>
            ))}
          </div>
          <div className="v-toolbar-right">
            <div className="v-toolbar-search">
              <FiSearch style={{ width: 14, height: 14, color: 'var(--v-ink-3)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search hospital, product, ID…"
              />
            </div>
          </div>
        </div>

        <div className="v-card">
          <div className="v-orders-head">
            <div>Hospital</div>
            <div>Product</div>
            <div>Qty</div>
            <div>Amount</div>
            <div>Status</div>
            <div>Actions</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 56, textAlign: 'center', color: 'var(--v-ink-3)' }}>
              No orders match these filters.
            </div>
          ) : filtered.map((order, i) => {
            const [c1, c2] = colorFor(order.hospital_name || 'Hospital');
            const pay = PAY_PILL[order.payment_status] || PAY_PILL.pending;
            return (
              <div key={order.eq_order_id} className="v-orders-row" style={{ animationDelay: `${i * 35}ms` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <div
                    className="v-hosp-mark"
                    style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                  >
                    {initials(order.hospital_name)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--v-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {order.hospital_name}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--v-ink-3)' }}>
                      {order.ordered_at ? new Date(order.ordered_at).toLocaleDateString('en-IN') : ''}
                    </div>
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--v-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {order.product_name}
                  </div>
                  <div style={{ fontSize: 11 }}>
                    <span
                      style={{
                        display: 'inline-flex', alignItems: 'center',
                        padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                        background: pay.bg, color: pay.color, textTransform: 'capitalize',
                      }}
                    >
                      {order.payment_status}
                    </span>
                  </div>
                </div>

                <div style={{ color: 'var(--v-ink-2)' }}>{order.quantity}</div>

                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontWeight: 700, fontSize: 15, letterSpacing: '-0.01em' }}>
                  ₹{Number(order.total_price || 0).toLocaleString('en-IN')}
                </div>

                <div>
                  <span className={`v-status ${order.order_status}`}>
                    <span className="pip" />
                    {STATUS_LABEL[order.order_status] || order.order_status}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {order.order_status === 'pending' && order.payment_status === 'paid' && (
                    <button
                      type="button"
                      disabled={confirmingId === order.eq_order_id}
                      onClick={() => confirmOrder(order.eq_order_id)}
                      className="v-btn-primary"
                      style={{ padding: '7px 14px', fontSize: 12 }}
                    >
                      {confirmingId === order.eq_order_id ? '…' : 'Confirm'}
                    </button>
                  )}
                  {order.order_status === 'confirmed' && (
                    <button
                      type="button"
                      onClick={() => openDispatch(order)}
                      className="v-btn-primary"
                      style={{ padding: '7px 14px', fontSize: 12 }}
                    >
                      <FiTruck style={{ width: 13, height: 13 }} /> Dispatch
                    </button>
                  )}
                  {order.order_status === 'dispatched' && (
                    <button
                      type="button"
                      onClick={() => openResend(order)}
                      className="v-btn-ghost"
                      style={{ padding: '7px 14px', fontSize: 12, color: 'var(--v-orange)', borderColor: 'var(--v-orange-soft)' }}
                    >
                      Resend OTP
                    </button>
                  )}
                  {order.order_status === 'delivered' && (
                    <span style={{ fontSize: 12, color: 'var(--v-green)', fontWeight: 600 }}>Delivered ✓</span>
                  )}
                  <button
                    type="button"
                    onClick={() => openChatWithHospital(order)}
                    disabled={openingChat === order.eq_order_id}
                    className="v-btn-ghost"
                    style={{ padding: '7px 12px', fontSize: 12 }}
                    title="Chat with hospital"
                  >
                    <FiMessageCircle style={{ width: 13, height: 13 }} />
                    {openingChat === order.eq_order_id ? '…' : 'Chat'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Dispatch modal */}
      <Modal isOpen={Boolean(dispatchModal)} onClose={() => setDispatchModal(null)} title="Dispatch Order">
        {dispatchModal && (
          <div className="space-y-4">
            <div className="bg-cream rounded-xl p-4 text-sm space-y-1.5 border border-hairline">
              <div className="flex justify-between"><span className="text-muted">Hospital</span><span className="font-medium text-ink">{dispatchModal.hospital_name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Product</span><span className="font-medium text-ink">{dispatchModal.product_name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Quantity</span><span className="font-medium text-ink">{dispatchModal.quantity}</span></div>
              <div className="flex justify-between"><span className="text-muted">Amount</span><span className="font-bold text-orange-500">₹{Number(dispatchModal.total_price).toLocaleString()}</span></div>
            </div>
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Estimated Delivery Days</label>
              <select
                className="input"
                value={dispatchForm.estimated_delivery_days}
                onChange={(e) => setDispatchForm((p) => ({ ...p, estimated_delivery_days: e.target.value }))}
              >
                {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Tracking Info <span className="text-gray-400 font-normal">(optional)</span></label>
              <input
                className="input"
                placeholder="Courier tracking number"
                value={dispatchForm.tracking_info}
                onChange={(e) => setDispatchForm((p) => ({ ...p, tracking_info: e.target.value }))}
              />
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-sm text-orange-700">
              A 6-digit OTP will be generated and emailed to the hospital admin.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDispatchModal(null)} className="btn-orange-outline flex-1">Cancel</button>
              <button onClick={handleDispatch} disabled={dispatching} className="btn-orange flex-1 disabled:opacity-60">
                <FiTruck className="w-4 h-4" />
                {dispatching ? 'Dispatching…' : 'Dispatch & Send OTP'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Resend OTP modal */}
      <Modal isOpen={Boolean(resendModal)} onClose={() => setResendModal(null)} title="Resend Delivery OTP">
        {resendModal && (
          <div className="space-y-4">
            <div className="bg-cream rounded-xl p-4 text-sm space-y-1.5 border border-hairline">
              <div className="flex justify-between"><span className="text-muted">Hospital</span><span className="font-medium text-ink">{resendModal.hospital_name}</span></div>
              <div className="flex justify-between"><span className="text-muted">Product</span><span className="font-medium text-ink">{resendModal.product_name}</span></div>
            </div>
            <div>
              <label className="text-sm font-medium text-ink mb-1.5 block">Updated Estimated Delivery Days</label>
              <select className="input" value={resendDays} onChange={(e) => setResendDays(e.target.value)}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div className="bg-orange-50 rounded-xl p-3 text-sm text-orange-700">
              Previous OTP is invalidated; a new one is emailed to the hospital admin.
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setResendModal(null)} className="btn-orange-outline">Cancel</button>
              <button onClick={handleResendOTP} disabled={resending} className="btn-orange disabled:opacity-60">
                {resending ? 'Sending…' : 'Resend OTP'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default VendorOrdersPage;
