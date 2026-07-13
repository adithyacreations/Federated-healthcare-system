import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  FiPackage, FiFileText, FiTruck, FiSearch, FiAlertOctagon, FiCheckSquare,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import StatsCard from '../../components/dashboard/StatsCard';
import QuickActionCard from '../../components/dashboard/QuickActionCard';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import Modal from '../../components/common/Modal';
import LiveIndicator from '../../components/common/LiveIndicator';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

const API_HOST = 'http://localhost:8000';

const rxFileUrl = (o) => {
  const path = o.prescription_local_url || o.prescription_url || '';
  if (!path) return '';
  return path.startsWith('http') ? path : `${API_HOST}${path}`;
};
const isPdf = (url) => url.toLowerCase().split('?')[0].endsWith('.pdf');

const TABS = [
  { key: 'rx', label: 'Pending Prescription Verification' },
  { key: 'dispatch', label: 'Ready to Dispatch' },
  { key: 'issues', label: 'Reported Issues' },
  { key: 'all', label: 'All Orders' },
];

const statusBadge = (s) => {
  const map = {
    pending: 'bg-orange-100 text-orange-700',
    prescription_required: 'bg-orange-100 text-orange-700',
    prescription_uploaded: 'bg-blue-100 text-blue-700',
    verified: 'bg-blue-100 text-blue-700',
    confirmed: 'bg-blue-100 text-blue-700',
    dispatched: 'bg-purple-100 text-purple-700',
    delivered: 'bg-green-100 text-green-700',
    wrong_product: 'bg-red-100 text-red-700',
    resolved: 'bg-green-100 text-green-800',
    refunded: 'bg-red-100 text-red-800',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${map[s] || 'bg-gray-100 text-gray-600'}`}>
      {String(s || '').replace(/_/g, ' ')}
    </span>
  );
};

const medList = (meds) =>
  Array.isArray(meds) ? meds.map((m) => m.name || m).join(', ') : meds || '—';

const PharmacistDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: stats } = useApi('/api/pharmacy/dashboard/', { pollInterval: 30000 });
  const { data: ordersRaw, loading, refetch, refreshing, lastUpdated } = useApi(
    '/api/pharmacy/orders/', { pollInterval: 30000 },
  );
  const { data: driversRaw, refetch: refetchDrivers } = useApi('/api/pharmacy/drivers/', { pollInterval: 30000 });

  const [wsConnected, setWsConnected] = useState(false);

  const [stockAlerts, setStockAlerts] = useState({
    expired: 0,
    expiring_30: 0,
    expiring_60: 0,
    expiring_90: 0,
    low_stock: 0,
    out_of_stock: 0,
    expired_items: [],
    expiring_items: [],
    low_stock_items: [],
  });

  useEffect(() => {
    const fetchStockAlerts = async () => {
      try {
        const response = await API.get('/api/pharmacy/stock-alerts/');
        if (response.data?.success) setStockAlerts(response.data.data);
      } catch (e) {
        /* best-effort */
      }
    };
    fetchStockAlerts();
    const id = setInterval(fetchStockAlerts, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loginId = user?.login_id;
    if (!loginId) return undefined;

    let ws;
    let reconnectTimer;
    let closed = false;

    const connect = () => {
      try {
        ws = new WebSocket(`ws://localhost:8000/ws/medicine/${loginId}/`);
      } catch {
        return; // The 30s REST poll still keeps the orders list fresh.
      }
      ws.onopen = () => setWsConnected(true);
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'new_order') {
          toast.success(
            `🛍️ ${msg.data?.message || `New order from ${msg.data?.patient_name || 'a patient'}!`}`,
            { duration: 5000, style: { background: '#F97316', color: 'white', fontWeight: 600 } },
          );
          refetch();
        } else if (msg.type === 'prescription_uploaded') {
          toast.success(`📄 ${msg.data?.patient_name || 'A patient'} uploaded a prescription!`);
          refetch();
        } else if (msg.type === 'payment_received') {
          toast.success(`💰 Payment received from ${msg.data?.patient_name || 'a patient'}! Ready to dispatch.`);
          refetch();
        }
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      try { ws?.close(); } catch { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login_id]);

  const [tab, setTab] = useState('rx');
  const [search, setSearch] = useState('');

  const [rxOrder, setRxOrder] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [dispatchOrder, setDispatchOrder] = useState(null);
  const [estDays, setEstDays] = useState(2);
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const [resolveOrder, setResolveOrder] = useState(null);
  const [resolution, setResolution] = useState('redeliver');
  const [resolving, setResolving] = useState(false);

  const [showAddDriver, setShowAddDriver] = useState(false);
  const [newDriverName, setNewDriverName] = useState('');
  const [newDriverPhone, setNewDriverPhone] = useState('');
  const [addingDriver, setAddingDriver] = useState(false);

  const orders = useMemo(() => ordersRaw || [], [ordersRaw]);
  const drivers = useMemo(() => driversRaw || [], [driversRaw]);

  const rxPending = orders.filter(
    (o) => o.requires_prescription && !o.prescription_verified
      && o.order_status === 'prescription_uploaded');
  const readyDispatch = orders.filter(
    (o) => o.order_status === 'confirmed' && o.payment_status === 'paid');
  const issuesList = orders.filter(
    (o) => o.order_status === 'wrong_product');
  const allFiltered = orders.filter((o) => {
    const q = search.trim().toLowerCase();
    return !q || `${o.patient_name} ${medList(o.medicines)}`.toLowerCase().includes(q);
  });

  const lowStock = stockAlerts.low_stock ?? stats?.low_stock_items ?? 0;

  const verifyRx = async (action) => {
    if (!rxOrder) return;
    if (action === 'reject' && !rejectReason.trim()) return toast.error('Enter a rejection reason');
    setVerifying(true);
    try {
      await API.post(`/api/pharmacy/orders/${rxOrder.med_order_id}/verify-prescription/`, {
        action,
        reason: rejectReason,
      });
      toast.success(action === 'approve' ? 'Prescription approved' : 'Prescription rejected');
      setRxOrder(null);
      setRejectReason('');
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const dispatch = async () => {
    if (!dispatchOrder) return;
    if (!driverName) {
      return toast.error('Please select a driver');
    }
    setDispatching(true);
    try {
      await API.put(`/api/pharmacy/orders/${dispatchOrder.med_order_id}/dispatch/`, {
        estimated_delivery_days: Number(estDays),
        driver_id: driverName,
      });
      toast.success('Order dispatched — OTP sent to patient');
      setDispatchOrder(null);
      setDriverName('');
      setDriverPhone('');
      refetch();
      refetchDrivers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Dispatch failed');
    } finally {
      setDispatching(false);
    }
  };

  const resolveIssue = async () => {
    if (!resolveOrder) return;
    if (resolution === 'redeliver' && !driverName) {
      return toast.error('Please select a driver for redelivery');
    }
    setResolving(true);
    try {
      await API.post(`/api/pharmacy/orders/${resolveOrder.med_order_id}/resolve-issue/`, {
        resolution,
        driver_id: resolution === 'redeliver' ? driverName : undefined,
      });
      toast.success('Issue marked as resolved');
      setResolveOrder(null);
      setDriverName('');
      refetch();
      refetchDrivers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Resolution failed');
    } finally {
      setResolving(false);
    }
  };

  const handleAddDriver = async () => {
    if (!newDriverName.trim() || !newDriverPhone.trim()) return;
    setAddingDriver(true);
    try {
      await API.post('/api/pharmacy/drivers/', { name: newDriverName, phone: newDriverPhone });
      toast.success('Driver added!');
      setShowAddDriver(false);
      setNewDriverName('');
      setNewDriverPhone('');
      refetchDrivers();
    } catch (err) {
      toast.error('Failed to add driver');
    } finally {
      setAddingDriver(false);
    }
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <DashboardHeader title="Pharmacist Dashboard" subtitle="Verify prescriptions · process & dispatch orders" />
          <div className="pt-1 flex items-center gap-3">
            {wsConnected && (
              <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: '#22C55E' }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#22C55E' }} />
                Live updates active
              </div>
            )}
            <LiveIndicator refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refetch} />
          </div>
        </div>

        {/* ─── Inventory alert banners ───────────────────────────── */}
        <div className="mb-6">
          {stockAlerts.expired > 0 && (
            <motion.div
              variants={cardVariants}
              className="rounded-2xl p-4 mb-3 border-2 flex items-start gap-3"
              style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }}
            >
              <span className="text-2xl">🚫</span>
              <div className="flex-1">
                <p className="font-bold text-red-700">
                  {stockAlerts.expired} Expired Medicine(s)!
                </p>
                <p className="text-red-600 text-sm mt-1">
                  Remove immediately from inventory!
                </p>
                {stockAlerts.expired_items?.map((item, i) => (
                  <p key={i} className="text-xs text-red-500 mt-1">
                    • {item.name} (expired {item.expiry})
                  </p>
                ))}
              </div>
              <button
                onClick={() => navigate('/pharmacist/inventory')}
                className="px-3 py-1 rounded-full text-xs font-medium text-white flex-shrink-0"
                style={{ backgroundColor: '#EF4444' }}
              >
                View →
              </button>
            </motion.div>
          )}

          {stockAlerts.expiring_30 > 0 && (
            <motion.div
              variants={cardVariants}
              className="rounded-2xl p-4 mb-3 border-2 flex items-start gap-3"
              style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
            >
              <span className="text-2xl">⚠️</span>
              <div className="flex-1">
                <p className="font-bold" style={{ color: '#F97316' }}>
                  {stockAlerts.expiring_30} Medicine(s) Expiring in 30 Days!
                </p>
                <p className="text-sm mt-1" style={{ color: '#EA580C' }}>
                  Plan restocking soon!
                </p>
                {stockAlerts.expiring_items?.map((item, i) => (
                  <p key={i} className="text-xs mt-1" style={{ color: '#F97316' }}>
                    • {item.name} — {item.days_left} days left ({item.stock} units)
                  </p>
                ))}
              </div>
              <button
                onClick={() => navigate('/pharmacist/inventory')}
                className="px-3 py-1 rounded-full text-xs font-medium text-white flex-shrink-0"
                style={{ backgroundColor: '#F97316' }}
              >
                View →
              </button>
            </motion.div>
          )}

          {stockAlerts.low_stock > 0 && (
            <motion.div
              variants={cardVariants}
              className="rounded-2xl p-4 mb-3 border-2 border-gray-200 flex items-start gap-3 bg-gray-50"
            >
              <span className="text-2xl">📦</span>
              <div className="flex-1">
                <p className="font-bold text-black">
                  {stockAlerts.low_stock} Low Stock Item(s)
                </p>
                <p className="text-gray-500 text-sm mt-1">
                  Consider reordering soon!
                </p>
                {stockAlerts.low_stock_items?.map((item, i) => (
                  <p key={i} className="text-xs text-gray-500 mt-1">
                    • {item.name} — only {item.stock} units left
                  </p>
                ))}
              </div>
              <button
                onClick={() => navigate('/pharmacist/inventory')}
                className="px-3 py-1 rounded-full text-xs font-medium text-white bg-black flex-shrink-0"
              >
                View →
              </button>
            </motion.div>
          )}

          {stockAlerts.expired === 0
            && stockAlerts.expiring_30 === 0
            && stockAlerts.low_stock === 0 && (
            <motion.div
              variants={cardVariants}
              className="rounded-2xl p-4 mb-3 border border-green-200 bg-green-50 flex items-center gap-3"
            >
              <span className="text-2xl">✅</span>
              <p className="font-medium text-green-700">
                All medicines are well stocked and within expiry! Great job!
              </p>
            </motion.div>
          )}
        </div>

        {/* ─── Stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard icon={FiPackage}  title="Orders to Dispatch"    value={stats?.pending_orders ?? 0} />
          <StatsCard icon={FiFileText} title="Pending Prescription Verification" value={stats?.rx_pending_verification ?? rxPending.length} />
          <StatsCard icon={FiAlertOctagon} title="Reported Issues"   value={issuesList.length} />
          <StatsCard icon={FiTruck}    title="Dispatched Orders"     value={stats?.dispatched_orders ?? 0} />
        </div>

        {/* ─── Quick actions ─────────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="dash-h2">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <QuickActionCard icon={FiPackage}    onClick={() => setTab('all')}  title="View Orders"          description="Browse all medicine orders" />
            <QuickActionCard icon={FiFileText}   onClick={() => setTab('rx')}   title="Verify Prescriptions" description={`${rxPending.length} pending`} />
            <QuickActionCard icon={FiCheckSquare} onClick={() => navigate('/pharmacist/inventory')} title="Manage Inventory"     description="Stock & medicine catalog" />
            <QuickActionCard icon={FiTruck} onClick={() => setShowAddDriver(true)} title="Manage Drivers" description={`${drivers.length} registered`} />
          </div>
        </section>

        {/* ─── Tabs ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-2 mb-5 border-b border-hairline pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-semibold rounded-t-lg transition ${
                tab === t.key ? 'text-orange-500 border-b-2 border-orange-500' : 'text-muted hover:text-orange-500'
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs opacity-70">
                ({t.key === 'rx' ? rxPending.length : t.key === 'dispatch' ? readyDispatch.length : t.key === 'issues' ? issuesList.length : orders.length})
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="dashboard-card text-sm text-muted">Loading orders…</div>
        ) : (
          <>
            {tab === 'rx' && (
              <div className="space-y-3">
                {rxPending.length === 0 && (
                  <div className="dashboard-card text-sm text-muted text-center py-8">No prescriptions awaiting verification.</div>
                )}
                {rxPending.length > 0 && (
                  <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: '#FFF7ED', color: '#9a3412' }}>
                    ℹ️ Orders are processed in the order they were received. Earlier orders have priority.
                  </div>
                )}
                {[...rxPending]
                  .sort((a, b) => new Date(a.ordered_at) - new Date(b.ordered_at))
                  .map((o, index) => (
                    <div key={o.med_order_id} className="dashboard-card flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink">{o.patient_name}</div>
                        <div className="text-xs text-muted max-w-md truncate">{medList(o.medicines)}</div>
                        <p className="text-xs text-gray-500 mt-1">
                          📅 Ordered: {o.ordered_at ? new Date(o.ordered_at).toLocaleString() : '—'}
                        </p>
                        <p className="text-xs font-medium" style={{ color: '#F97316' }}>
                          Queue position: #{index + 1}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {rxFileUrl(o) && !isPdf(rxFileUrl(o)) && (
                          <a href={rxFileUrl(o)} target="_blank" rel="noopener noreferrer">
                            <img src={rxFileUrl(o)} alt="Prescription" className="w-12 h-12 object-cover rounded-lg border border-hairline" />
                          </a>
                        )}
                        <button onClick={() => { setRxOrder(o); setRejectReason(''); }} className="btn-orange text-sm">
                          Verify Prescription
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}

            {tab === 'dispatch' && (
              <div className="space-y-3">
                {readyDispatch.length === 0 && (
                  <div className="dashboard-card text-sm text-muted text-center py-8">No paid orders ready to dispatch.</div>
                )}
                {readyDispatch.map((o) => (
                  <div key={o.med_order_id} className="dashboard-card flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink">{o.patient_name}</div>
                      <div className="text-xs text-muted max-w-md">{medList(o.medicines)}</div>
                      <div className="text-xs text-muted mt-1">{o.delivery_address || 'No address'}</div>
                      {o.delivery_phone && (
                        <a
                          href={`tel:${o.delivery_phone}`}
                          className="inline-flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold"
                          style={{ backgroundColor: '#F0FDF4', color: '#16A34A' }}
                        >
                          📞 {o.delivery_phone} · Call
                        </a>
                      )}
                      <div className="text-sm font-semibold text-ink mt-1">₹{o.total_amount} · paid</div>
                    </div>
                    <button onClick={() => { setDispatchOrder(o); setEstDays(2); setDriverName(''); }} className="btn-orange text-sm">
                      <FiTruck className="w-4 h-4" /> Dispatch
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'issues' && (
              <div className="space-y-3">
                {issuesList.length === 0 && (
                  <div className="dashboard-card text-sm text-muted text-center py-8">No reported issues.</div>
                )}
                {issuesList.map((o) => (
                  <div key={o.med_order_id} className="dashboard-card border border-red-200 bg-red-50/50 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-red-700 flex items-center gap-2">
                        ⚠️ Wrong Product Reported <span className="text-sm font-normal text-red-600">({o.issue_type})</span>
                      </div>
                      <div className="font-medium text-ink mt-1">Patient: {o.patient_name}</div>
                      <div className="text-xs text-muted max-w-md mt-0.5">{medList(o.medicines)}</div>
                      <div className="mt-2 text-sm font-semibold text-ink">Driver Details</div>
                      <div className="text-xs text-muted">Name: {o.driver_name || 'N/A'}</div>
                      <div className="text-xs text-muted">Phone: {o.driver_phone || 'N/A'}</div>
                    </div>
                    <button onClick={() => { setResolveOrder(o); setResolution('redelivered'); }} className="px-4 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: '#EF4444' }}>
                      Resolve Issue
                    </button>
                  </div>
                ))}
              </div>
            )}

            {tab === 'all' && (
              <div className="dashboard-card">
                <div className="relative mb-3 max-w-xs">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    className="input-field pl-9 w-full"
                    placeholder="Search orders…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-hairline text-muted">
                        <th className="text-left py-2 px-3 font-medium">Patient</th>
                        <th className="text-left py-2 px-3 font-medium">Medicines</th>
                        <th className="text-left py-2 px-3 font-medium">Amount</th>
                        <th className="text-left py-2 px-3 font-medium">Status</th>
                        <th className="text-left py-2 px-3 font-medium">Payment</th>
                        <th className="text-left py-2 px-3 font-medium">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allFiltered.length === 0 && (
                        <tr><td colSpan={6} className="text-center py-8 text-muted">No orders</td></tr>
                      )}
                      {allFiltered.map((o) => (
                        <tr key={o.med_order_id} className="border-b border-hairline hover:bg-orange-50/40">
                          <td className="py-3 px-3 font-medium text-ink">{o.patient_name}</td>
                          <td className="py-3 px-3 text-muted max-w-xs truncate">{medList(o.medicines)}</td>
                          <td className="py-3 px-3 font-semibold text-ink">₹{Number(o.total_amount || 0).toFixed(2)}</td>
                          <td className="py-3 px-3">{statusBadge(o.order_status)}</td>
                          <td className="py-3 px-3 capitalize text-muted">{o.payment_status}</td>
                          <td className="py-3 px-3 text-muted">
                            {o.ordered_at ? new Date(o.ordered_at).toLocaleDateString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </motion.div>

      {/* Verify Rx modal */}
      <Modal isOpen={Boolean(rxOrder)} onClose={() => setRxOrder(null)} title="Verify Prescription" size="lg">
        {rxOrder && (
          <div className="space-y-4">
            <div className="text-sm">
              <span className="text-muted">Patient:</span> <strong>{rxOrder.patient_name}</strong>
              <span className="mx-2">·</span>
              <span className="text-muted">Medicines:</span> {medList(rxOrder.medicines)}
            </div>
            {rxFileUrl(rxOrder) ? (
              <div className="border border-hairline rounded-xl overflow-hidden">
                {isPdf(rxFileUrl(rxOrder)) ? (
                  <div className="bg-gray-50 p-6 text-center">
                    <div className="text-5xl mb-3">📄</div>
                    <p className="font-medium text-sm mb-3">PDF Prescription</p>
                    <a
                      href={rxFileUrl(rxOrder)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-6 py-2 rounded-full text-white text-sm font-medium"
                      style={{ backgroundColor: '#F97316' }}
                    >
                      📥 Open Prescription PDF
                    </a>
                  </div>
                ) : (
                  <img
                    src={rxFileUrl(rxOrder)}
                    alt="Prescription"
                    className="w-full max-h-80 object-contain bg-white"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
                    }}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No prescription file uploaded.</p>
            )}
            <div>
              <label className="text-xs text-muted">Rejection reason (required to reject)</label>
              <input
                className="input-field"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason if rejecting…"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => verifyRx('approve')} disabled={verifying} className="btn-orange flex-1 disabled:opacity-60">
                Approve
              </button>
              <button onClick={() => verifyRx('reject')} disabled={verifying} className="btn-danger flex-1 disabled:opacity-60">
                Reject
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Dispatch modal */}
      <Modal isOpen={Boolean(dispatchOrder)} onClose={() => setDispatchOrder(null)} title="Dispatch Order">
        {dispatchOrder && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Dispatching order for <strong>{dispatchOrder.patient_name}</strong>. A delivery
              OTP will be emailed to the patient.
            </p>
            <div>
              <label className="text-xs text-muted">Estimated delivery days</label>
              <select className="input-field mb-2" value={estDays} onChange={(e) => setEstDays(e.target.value)}>
                {[1, 2, 3, 4, 5].map((dd) => <option key={dd} value={dd}>{dd} day{dd > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted mb-1 block">Assign Delivery Driver</label>
              <select
                className="input-field mb-2"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
              >
                <option value="">Select an available driver...</option>
                {drivers.map(d => (
                  <option key={d.driver_id} value={d.driver_id} disabled={!d.is_available}>
                    {d.name} ({d.phone}) {d.is_available ? '🟢' : '🔴 On Delivery'}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={dispatch} disabled={dispatching} className="btn-orange w-full disabled:opacity-60">
              {dispatching ? 'Dispatching…' : 'Dispatch & Send OTP'}
            </button>
          </div>
        )}
      </Modal>

      {/* Resolve Issue Modal */}
      <Modal isOpen={Boolean(resolveOrder)} onClose={() => setResolveOrder(null)} title="Resolve Issue">
        {resolveOrder && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Select how you want to resolve the "Wrong Product" issue for <strong>{resolveOrder.patient_name}</strong>.
            </p>
            <div>
              <label className="text-xs text-muted mb-1 block">Resolution Action</label>
              {resolveOrder.patient_desired_resolution && (
                <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
                  <strong>Patient requested:</strong> <span className="capitalize">{resolveOrder.patient_desired_resolution}</span>
                </div>
              )}
              <select className="input-field mb-2" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option value="redelivered">Redeliver the correct items</option>
                <option value="refunded">Refund the order amount</option>
              </select>
            </div>
            
            {resolution === 'redelivered' && (
              <div>
                <label className="text-xs text-muted mb-1 block">Assign Driver for Redelivery</label>
                <select
                  className="input-field mb-2"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                >
                  <option value="">Select an available driver...</option>
                  {drivers.map(d => (
                    <option key={d.driver_id} value={d.driver_id} disabled={!d.is_available}>
                      {d.name} ({d.phone}) {d.is_available ? '🟢' : '🔴 On Delivery'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={resolveIssue} disabled={resolving} className="px-4 py-2 w-full rounded-lg text-sm font-medium text-white disabled:opacity-60" style={{ backgroundColor: '#EF4444' }}>
              {resolving ? 'Resolving…' : 'Confirm Resolution'}
            </button>
          </div>
        )}
      </Modal>

      {/* Add Driver Modal */}
      <Modal isOpen={showAddDriver} onClose={() => setShowAddDriver(false)} title="Add Delivery Driver">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted mb-1 block">Driver Name</label>
            <input
              className="input-field"
              placeholder="E.g. John Doe"
              value={newDriverName}
              onChange={(e) => setNewDriverName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted mb-1 block">Phone Number</label>
            <input
              className="input-field"
              placeholder="E.g. 9876543210"
              maxLength={10}
              value={newDriverPhone}
              onChange={(e) => setNewDriverPhone(e.target.value.replace(/[^0-9]/g, ''))}
            />
          </div>
          <button
            onClick={handleAddDriver}
            disabled={addingDriver || !newDriverName.trim() || !newDriverPhone.trim()}
            className="w-full btn-primary"
          >
            {addingDriver ? 'Adding...' : 'Add Driver'}
          </button>
        </div>
      </Modal>

    </DashboardLayout>
  );
};

export default PharmacistDashboard;
