import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import {
  FiShoppingCart, FiRefreshCw, FiCheckCircle, FiPackage,
  FiTruck, FiClock, FiMapPin, FiFilter,
} from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import HospitalChatWindow from '../../components/chat/HospitalChatWindow';

// ─── Constants ────────────────────────────────────────────────────────────────

const HISTORY_ICON = {
  pending:    '📦',
  confirmed:  '💳',
  dispatched: '🚚',
  delivered:  '✅',
  otp_resent: '🔄',
};

const PAY_BADGE = {
  pending: 'bg-gray-100   text-gray-600',
  paid:    'bg-green-100  text-green-700',
  failed:  'bg-red-100    text-red-700',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
};

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return iso; }
};

const getHistoryTime = (order, status) => {
  const history = order.status_history || [];
  const entry = history.find(h => h.status === status);
  return entry ? entry.timestamp : null;
};

const loadRazorpay = () =>
  new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const existing = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) { existing.addEventListener('load', () => resolve(true)); return; }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });

// ─── ProductImage ──────────────────────────────────────────────────────────────

const CATEGORY_EMOJI = {
  'Diagnostic': '🔬', 'Imaging': '📡', 'Respiratory': '💨',
  'Surgical': '✂️', 'equipment': '🔬', 'medicine': '💊', 'supply': '📦',
};

const ProductImage = ({ image_url, product_name, category }) => {
  const [imgError, setImgError] = useState(false);
  if (image_url && image_url.startsWith('http') && !imgError) {
    return (
      <img
        src={image_url}
        alt={product_name}
        className="w-full h-40 object-cover rounded-t-xl"
        onError={() => setImgError(true)}
      />
    );
  }
  return (
    <div className="w-full h-40 bg-blue-50 rounded-t-xl flex flex-col items-center justify-center">
      <span className="text-5xl">{CATEGORY_EMOJI[category] || '🏥'}</span>
      <p className="text-xs text-gray-500 mt-2 text-center px-2">{product_name}</p>
    </div>
  );
};

// ─── StatusTracker ────────────────────────────────────────────────────────────

const StatusTracker = ({ order }) => {
  const steps = [
    {
      label:     'Order Placed',
      icon:      '📦',
      completed: true,
      timestamp: order.ordered_at ? fmtDateTime(order.ordered_at) : null,
    },
    {
      label:     'Payment Confirmed',
      icon:      '💳',
      completed: order.payment_status === 'paid',
      timestamp: getHistoryTime(order, 'confirmed'),
    },
    {
      label:     'Dispatched',
      icon:      '🚚',
      completed: ['dispatched', 'delivered'].includes(order.order_status),
      timestamp: order.dispatched_at ? fmtDateTime(order.dispatched_at) : null,
    },
    {
      label:     'Delivered',
      icon:      '✅',
      completed: order.order_status === 'delivered',
      timestamp: order.delivered_at ? fmtDateTime(order.delivered_at) : null,
    },
  ];

  return (
    <div className="flex items-start my-4">
      {steps.map((step, i) => {
        const last      = i === steps.length - 1;
        const lineGreen = !last && steps[i + 1].completed;
        return (
          <div key={step.label} className="flex items-start flex-1 last:flex-none">
            <div className="flex flex-col items-center" style={{ minWidth: '60px' }}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2 transition-all ${
                step.completed
                  ? 'bg-green-500 border-green-500 text-white shadow-sm'
                  : 'bg-white border-gray-200 text-gray-300'
              }`}>
                {step.completed ? step.icon : '○'}
              </div>
              <p className={`text-xs mt-1 text-center leading-tight font-medium ${step.completed ? 'text-gray-700' : 'text-gray-400'}`}
                style={{ width: '60px' }}>
                {step.label}
              </p>
              {step.timestamp && (
                <p className="text-center mt-0.5 leading-tight text-gray-400"
                  style={{ width: '64px', fontSize: '9px' }}>
                  {step.timestamp}
                </p>
              )}
            </div>
            {!last && (
              <div className={`flex-1 h-0.5 mx-1 mt-4 ${lineGreen ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
};

// ─── TimelineModal ────────────────────────────────────────────────────────────

const TimelineModal = ({ order, onClose }) => {
  if (!order) return null;
  const history = Array.isArray(order.status_history) ? order.status_history : [];
  return (
    <Modal isOpen={true} onClose={onClose} title={`Track Order — ${order.product_name}`}>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5">
          <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-medium">{order.product_name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="font-medium">{order.vendor_name}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Quantity</span><span className="font-medium">{order.quantity}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Amount</span><span className="font-bold text-primary-500">₹{parseFloat(order.total_price).toLocaleString('en-IN')}</span></div>
          {order.tracking_info && (
            <div className="flex justify-between"><span className="text-gray-500">Tracking</span><span className="font-medium">{order.tracking_info}</span></div>
          )}
          {order.estimated_delivery_days && order.order_status === 'dispatched' && (
            <div className="flex justify-between"><span className="text-gray-500">Est. Delivery</span><span className="font-medium">{order.estimated_delivery_days} days from dispatch</span></div>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-gray-700 mb-3">Order Timeline</p>
          {history.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No history recorded yet.</p>
          ) : (
            <div className="relative pl-8 space-y-4">
              {history.map((entry, i) => (
                <div key={i} className="relative">
                  {i < history.length - 1 && (
                    <div className="absolute left-[-20px] top-6 w-0.5 h-full bg-gray-200" />
                  )}
                  <div className="absolute left-[-26px] top-1 w-5 h-5 rounded-full bg-white border-2 border-primary-500 flex items-center justify-center text-xs">
                    {HISTORY_ICON[entry.status] || '•'}
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-sm font-semibold text-gray-800 capitalize">
                        {entry.status === 'otp_resent' ? 'OTP Resent' : entry.status}
                      </span>
                      <span className="text-xs text-gray-400">{entry.timestamp}</span>
                    </div>
                    {entry.note && <p className="text-xs text-gray-500">{entry.note}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={onClose} className="btn-secondary w-full">Close</button>
      </div>
    </Modal>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const EquipmentOrdersPage = () => {
  const catalog = useApi('/api/vendor/catalog/');
  const orders  = useApi('/api/hospital/equipment-orders/');

  const [orderModal, setOrderModal]     = useState(null);
  const [qty, setQty]                   = useState(1);
  const [placing, setPlacing]           = useState(false);
  const [activeTab, setActiveTab]       = useState('catalog');
  const [successOrder, setSuccessOrder] = useState(null);

  // Catalog filters
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [vendorFilter, setVendorFilter]     = useState('All');

  // OTP confirmation
  const [otpModal, setOtpModal]   = useState(null);
  const [otpValue, setOtpValue]   = useState('');
  const [verifying, setVerifying] = useState(false);

  // Tracking timeline
  const [trackModal, setTrackModal] = useState(null);

  // Contact vendor + file complaint
  const [showContactModal, setShowContactModal]               = useState(false);
  const [showVendorComplaintModal, setShowVendorComplaintModal] = useState(false);
  const [selectedOrder, setSelectedOrder]                     = useState(null);
  const [vendorComplaintSubject, setVendorComplaintSubject]   = useState('');
  const [vendorComplaintDesc, setVendorComplaintDesc]         = useState('');

  // Vendor chat — opened from inside Contact Vendor modal.
  const [chatLoading, setChatLoading] = useState(false);
  const [activeChatId, setActiveChatId] = useState(null);
  const [activeChatVendor, setActiveChatVendor] = useState('');
  const [activeChatOrderRef, setActiveChatOrderRef] = useState('');
  const [showChat, setShowChat] = useState(false);

  const openVendorChat = async (order) => {
    try {
      setChatLoading(true);
      const r = await API.post('/api/vendor/chat/get-or-create/', {
        vendor_id: order.vendor_id,
        order_id: order.eq_order_id,
      });
      if (r.data?.success) {
        setActiveChatId(r.data.data.chat_id);
        setActiveChatVendor(r.data.data.vendor_name || order.vendor_name);
        setActiveChatOrderRef(String(order.eq_order_id).slice(0, 8));
        setShowContactModal(false);
        setShowChat(true);
      }
    } catch {
      toast.error('Failed to open chat!');
    } finally {
      setChatLoading(false);
    }
  };

  const submitVendorComplaint = async () => {
    try {
      const response = await API.post('/api/hospital/file-vendor-complaint/', {
        vendor_id:   selectedOrder.vendor_id,
        subject:     vendorComplaintSubject,
        description: vendorComplaintDesc,
        order_id:    selectedOrder.eq_order_id,
      });
      if (response.data.success) {
        toast.success('Complaint submitted!');
        setShowVendorComplaintModal(false);
        setVendorComplaintSubject('');
        setVendorComplaintDesc('');
      }
    } catch {
      toast.error('Failed to submit complaint!');
    }
  };

  const catalogList = Array.isArray(catalog.data) ? catalog.data : [];
  const orderList   = Array.isArray(orders.data)  ? orders.data  : [];

  // Derived filter options
  const categories = useMemo(() => {
    const cats = new Set(catalogList.map(p => p.category).filter(Boolean));
    return ['All', ...Array.from(cats).sort()];
  }, [catalogList]);

  const vendors = useMemo(() => {
    const vMap = {};
    catalogList.forEach(p => { if (p.vendor_id && p.vendor_name) vMap[p.vendor_id] = p.vendor_name; });
    return [{ id: 'All', name: 'All Vendors' }, ...Object.entries(vMap).map(([id, name]) => ({ id, name }))];
  }, [catalogList]);

  const filteredCatalog = useMemo(() => {
    return catalogList.filter(p => {
      const catMatch  = categoryFilter === 'All' || p.category === categoryFilter;
      const vendMatch = vendorFilter === 'All'   || p.vendor_id === vendorFilter;
      return catMatch && vendMatch;
    });
  }, [catalogList, categoryFilter, vendorFilter]);

  const openOrder = (product) => { setOrderModal(product); setQty(1); setSuccessOrder(null); };

  // ─── Place order + Razorpay ───────────────────────────────────────────────
  const handlePlaceOrder = async () => {
    if (!orderModal) return;
    if (qty < 1 || qty > orderModal.stock_qty) {
      toast.error(`Quantity must be between 1 and ${orderModal.stock_qty}`);
      return;
    }
    setPlacing(true);

    const productName   = orderModal.product_name;
    const vendorName    = orderModal.vendor_name;
    const orderedQty    = qty;
    const computedTotal = (parseFloat(orderModal.price || 0) * orderedQty).toFixed(2);

    try {
      const { data } = await API.post('/api/vendor/place-order/', {
        product_id: orderModal.product_id,
        quantity:   orderedQty,
      });
      const d = data?.data || {};
      const eqOrderId = d.eq_order_id;

      if (!d.razorpay_order_id || !d.razorpay_key) {
        toast.success('Order placed successfully!');
        setOrderModal(null);
        orders.refetch();
        catalog.refetch();
        return;
      }

      if (!eqOrderId) {
        toast.error('Order ID missing in server response.');
        return;
      }

      const loaded = await loadRazorpay();
      if (!loaded) { toast.error('Could not load payment gateway. Try again.'); return; }

      const rzp = new window.Razorpay({
        key:         d.razorpay_key,
        amount:      Math.round(parseFloat(d.total_price) * 100),
        currency:    'INR',
        name:        'FederCare Equipment',
        description: `${productName} × ${orderedQty}`,
        order_id:    d.razorpay_order_id,
        handler: async (response) => {
          try {
            await API.post('/api/payment/verify/', {
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              payment_type: 'equipment',
              object_id:    eqOrderId,
            });
            toast.success('Payment successful! Order confirmed.');
            setOrderModal(null);
            setSuccessOrder({ product_name: productName, vendor_name: vendorName, quantity: orderedQty, total_price: computedTotal });
            setActiveTab('orders');
            orders.refetch();
            catalog.refetch();
          } catch (err) {
            console.error('Verify error:', err?.response?.data || err);
            toast.error(err?.response?.data?.message || 'Payment verification failed');
          }
        },
        prefill: { name: 'Hospital Admin' },
        theme:   { color: '#1A3C6E' },
        modal:   { ondismiss: () => { setPlacing(false); toast('Payment cancelled', { icon: 'ℹ️' }); } },
      });
      rzp.open();
    } catch (err) {
      console.error('Place order error:', err?.response?.data || err);
      toast.error(err?.response?.data?.message || 'Failed to place order');
    } finally {
      setPlacing(false);
    }
  };

  // ─── OTP verification ─────────────────────────────────────────────────────
  const openOTPModal = (order) => { setOtpModal(order); setOtpValue(''); };

  const handleConfirmDelivery = async () => {
    if (!otpModal || otpValue.length !== 6) { toast.error('Enter a 6-digit OTP.'); return; }
    setVerifying(true);
    try {
      const res = await API.post(`/api/hospital/orders/${otpModal.eq_order_id}/confirm-delivery/`, { otp: otpValue });
      toast.success(res.data?.message || 'Delivery confirmed!');
      setOtpModal(null);
      setOtpValue('');
      orders.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'OTP verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const totalPrice = orderModal ? (parseFloat(orderModal.price || 0) * qty).toFixed(2) : 0;

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Equipment Orders</h1>
          <p className="text-sm text-gray-500">Browse vendor catalog and manage equipment orders</p>
        </div>
        <button onClick={() => { catalog.refetch(); orders.refetch(); }}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ─── Success Banner ───────────────────────────────────── */}
      {successOrder && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <FiCheckCircle className="w-6 h-6 text-green-500 mt-0.5 shrink-0" />
            <div>
              <p className="font-bold text-green-800 text-base mb-2">Order Placed Successfully!</p>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm text-green-700">
                <span className="text-green-500">Product</span><span className="font-medium">{successOrder.product_name}</span>
                <span className="text-green-500">Vendor</span><span className="font-medium">{successOrder.vendor_name}</span>
                <span className="text-green-500">Quantity</span><span className="font-medium">{successOrder.quantity}</span>
                <span className="text-green-500">Amount Paid</span><span className="font-bold">₹{parseFloat(successOrder.total_price).toLocaleString('en-IN')}</span>
              </div>
              <p className="text-xs text-green-600 mt-2">Vendor will dispatch your order soon.</p>
            </div>
          </div>
          <button onClick={() => setSuccessOrder(null)} className="mt-3 text-xs text-green-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* ─── Tabs ─────────────────────────────────────────────── */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {[{ key: 'catalog', label: 'Browse Catalog' }, { key: 'orders', label: `My Orders (${orderList.length})` }].map(({ key, label }) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === key ? 'bg-white text-primary-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ─── Catalog Tab ──────────────────────────────────────── */}
      {activeTab === 'catalog' && (
        <>
          {/* Filters */}
          {!catalog.loading && catalogList.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
                {categories.map((cat) => (
                  <button key={cat} onClick={() => setCategoryFilter(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${categoryFilter === cat ? 'bg-white text-primary-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {cat}
                  </button>
                ))}
              </div>
              {vendors.length > 2 && (
                <div className="flex items-center gap-1.5">
                  <FiFilter className="w-3.5 h-3.5 text-gray-400" />
                  <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}
                    className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-primary-200">
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {(categoryFilter !== 'All' || vendorFilter !== 'All') && (
                <button onClick={() => { setCategoryFilter('All'); setVendorFilter('All'); }}
                  className="text-xs text-gray-400 hover:text-gray-600 underline">
                  Clear filters
                </button>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                {filteredCatalog.length} product{filteredCatalog.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {catalog.loading ? (
            <div className="card text-center text-gray-400 py-8">Loading catalog…</div>
          ) : filteredCatalog.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">🏭</div>
              <p className="text-gray-500">
                {catalogList.length === 0 ? 'No products in catalog yet.' : 'No products match your filters.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCatalog.map((p) => (
                <div key={p.product_id} className="border border-gray-100 rounded-xl overflow-hidden hover:shadow-md transition bg-white">
                  <ProductImage image_url={p.image_url} product_name={p.product_name} category={p.category} />
                  <div className="p-4">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-bold text-gray-800 text-base">{p.product_name}</h3>
                      {p.category && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full capitalize shrink-0 ml-2">
                          {p.category}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-1">
                      🏭 <span className="font-medium">{p.vendor_name}</span>
                    </p>
                    {p.vendor_phone && (
                      <p className="text-xs text-gray-400 mb-3">📞 {p.vendor_phone}</p>
                    )}
                    <p className="text-xl font-bold text-green-600 mb-1">
                      ₹{parseFloat(p.price).toLocaleString('en-IN')}
                    </p>
                    <p className="text-xs text-gray-400 mb-3">📦 {p.stock_qty} in stock</p>
                    <button onClick={() => openOrder(p)} disabled={p.stock_qty === 0}
                      className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 font-medium w-full disabled:opacity-40 text-sm">
                      {p.stock_qty === 0 ? 'Out of Stock' : 'Order Now'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── My Orders Tab ────────────────────────────────────── */}
      {activeTab === 'orders' && (
        <div className="space-y-4">
          {orders.loading ? (
            <div className="card text-center text-gray-400 py-8">Loading orders…</div>
          ) : orderList.length === 0 ? (
            <div className="card text-center py-12">
              <div className="text-4xl mb-3">📋</div>
              <p className="text-gray-500">No equipment orders yet.</p>
            </div>
          ) : (
            orderList.map((o) => (
              <div key={o.eq_order_id} className="card">
                {/* Header */}
                <div className="flex items-start justify-between mb-1">
                  <div>
                    <h3 className="font-bold text-gray-800">{o.product_name}</h3>
                    <p className="text-xs text-gray-500">
                      by {o.vendor_name} &bull; Qty: {o.quantity} &bull; ₹{parseFloat(o.total_price).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${PAY_BADGE[o.payment_status] || 'bg-gray-100 text-gray-600'}`}>
                      {o.payment_status}
                    </span>
                    <span className="text-xs text-gray-400">{fmtDate(o.ordered_at)}</span>
                  </div>
                </div>

                {/* Status tracker with timestamps */}
                <StatusTracker order={o} />

                {/* Dispatched info */}
                {o.order_status === 'dispatched' && (
                  <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-sm">
                    <div className="flex items-start gap-2">
                      <FiTruck className="w-4 h-4 text-yellow-600 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="font-semibold text-yellow-800">Your order is on the way!</p>
                        {o.estimated_delivery_days && (
                          <p className="text-yellow-700">
                            Estimated delivery: {o.estimated_delivery_days} day{o.estimated_delivery_days > 1 ? 's' : ''}
                          </p>
                        )}
                        {o.tracking_info && (
                          <p className="text-yellow-700 flex items-center gap-1">
                            <FiMapPin className="w-3 h-3" /> Tracking: {o.tracking_info}
                          </p>
                        )}
                        <p className="text-yellow-600 mt-1 flex items-center gap-1">
                          <FiClock className="w-3 h-3" /> Check your email for the delivery OTP
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Delivered info */}
                {o.order_status === 'delivered' && (
                  <div className="mt-2 bg-green-50 border border-green-200 rounded-xl p-3 text-sm flex items-start gap-2">
                    <FiCheckCircle className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-green-800">Delivered on {fmtDate(o.delivered_at)}</p>
                      <p className="text-green-700 text-xs">Items added to hospital inventory ✓</p>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button onClick={() => setTrackModal(o)}
                    className="inline-flex items-center gap-1.5 text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition">
                    <FiPackage className="w-3.5 h-3.5" /> Track Order
                  </button>
                  <button
                    onClick={() => { setSelectedOrder(o); setShowContactModal(true); }}
                    className="px-4 py-2 rounded-full text-sm font-medium border-2 border-black text-black hover:bg-black hover:text-white transition-all"
                  >
                    📞 Contact Vendor
                  </button>
                  <button
                    onClick={() => { setSelectedOrder(o); setShowVendorComplaintModal(true); }}
                    className="px-4 py-2 rounded-full text-sm font-medium text-white transition-all"
                    style={{ backgroundColor: '#F97316' }}
                  >
                    🚩 File Complaint
                  </button>
                  {o.order_status === 'dispatched' && (
                    <button onClick={() => openOTPModal(o)}
                      className="bg-orange-500 text-white px-4 py-2 rounded-lg hover:bg-orange-600 font-medium text-xs inline-flex items-center gap-1.5">
                      <FiCheckCircle className="w-3.5 h-3.5" /> Confirm Receipt
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ─── Place Order Modal ────────────────────────────────── */}
      <Modal isOpen={Boolean(orderModal)} onClose={() => setOrderModal(null)}
        title={`Order: ${orderModal?.product_name}`}>
        {orderModal && (
          <>
            <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="font-medium">{orderModal.vendor_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Unit Price</span><span className="font-semibold">₹{parseFloat(orderModal.price).toLocaleString('en-IN')}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">In Stock</span><span className="font-medium text-green-600">{orderModal.stock_qty} units</span></div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Quantity</label>
              <input type="number" min={1} max={orderModal.stock_qty} value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(orderModal.stock_qty, parseInt(e.target.value) || 1)))}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300" />
            </div>

            <div className="bg-blue-50 rounded-xl p-3 mb-5 flex items-center justify-between">
              <span className="text-sm text-gray-600 font-medium">Total Amount</span>
              <span className="text-xl font-bold text-primary-500">₹{parseFloat(totalPrice).toLocaleString('en-IN')}</span>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => setOrderModal(null)} className="btn-secondary">Cancel</button>
              <button onClick={handlePlaceOrder} disabled={placing}
                className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition shadow-md disabled:opacity-60">
                <FiShoppingCart className="w-4 h-4" />
                {placing ? 'Processing…' : 'Place Order & Pay'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ─── OTP Confirm Modal ────────────────────────────────── */}
      <Modal isOpen={Boolean(otpModal)} onClose={() => { setOtpModal(null); setOtpValue(''); }}
        title="Confirm Delivery">
        {otpModal && (
          <div className="space-y-5">
            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-gray-500">Product</span><span className="font-medium">{otpModal.product_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Vendor</span><span className="font-medium">{otpModal.vendor_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Quantity</span><span className="font-medium">{otpModal.quantity}</span></div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter the 6-digit OTP from your email
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpValue}
                onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                placeholder="000000"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-center text-2xl font-bold font-mono tracking-[0.5em] focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-200"
              />
              <p className="text-xs text-gray-400 text-center mt-1">Numbers only · 6 digits</p>
            </div>

            <div className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700">
              Once verified, items will be automatically added to your hospital inventory.
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => { setOtpModal(null); setOtpValue(''); }} className="btn-secondary">Cancel</button>
              <button onClick={handleConfirmDelivery} disabled={verifying || otpValue.length !== 6}
                className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60">
                <FiCheckCircle className="w-4 h-4" />
                {verifying ? 'Verifying…' : 'Verify & Confirm'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Contact Vendor Modal ─────────────────────────────── */}
      {showContactModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-2xl p-6 w-full max-w-md" style={{ backgroundColor: '#FAF7F2' }}>
            <h3 className="font-bold text-xl mb-4">Contact Vendor</h3>
            <div className="bg-white rounded-xl p-4 space-y-3 mb-4 text-sm">
              <p><b>Company:</b> {selectedOrder.vendor_name}</p>
              <p><b>Contact:</b> {selectedOrder.vendor_phone || '—'}</p>
              <p><b>Email:</b> {selectedOrder.vendor_email || '—'}</p>
              <p><b>Order ID:</b> {String(selectedOrder.eq_order_id).slice(0, 8)}</p>
            </div>
            <button
              onClick={() => openVendorChat(selectedOrder)}
              disabled={chatLoading}
              className="w-full py-3 rounded-full font-semibold text-white mb-3 disabled:opacity-50"
              style={{ backgroundColor: '#F97316' }}
            >
              {chatLoading ? '⏳ Opening chat…' : '💬 Chat with Vendor'}
            </button>
            <div className="flex gap-3">
              <a
                href={`mailto:${selectedOrder.vendor_email}`}
                className="flex-1 py-3 rounded-full font-semibold text-white text-center transition-all"
                style={{ backgroundColor: '#F97316' }}
              >
                📧 Send Email
              </a>
              <button
                onClick={() => setShowContactModal(false)}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline vendor chat panel — bottom-right floating window. */}
      {showChat && activeChatId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end justify-end p-4">
          <div className="bg-white rounded-2xl w-full max-w-md h-[28rem] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-bold">💬 Vendor Chat</h3>
              <button
                onClick={() => setShowChat(false)}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center hover:bg-gray-200"
              >
                ✕
              </button>
            </div>
            <HospitalChatWindow
              chatId={activeChatId}
              vendorName={activeChatVendor}
              orderRef={activeChatOrderRef}
            />
          </div>
        </div>
      )}

      {/* ─── File Vendor Complaint Modal ──────────────────────── */}
      {showVendorComplaintModal && selectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-2xl p-6 w-full max-w-md" style={{ backgroundColor: '#FAF7F2' }}>
            <h3 className="font-bold text-xl mb-2">File Vendor Complaint</h3>
            <p className="text-gray-500 text-sm mb-4">
              Order: {selectedOrder.product_name} from {selectedOrder.vendor_name}
            </p>
            <input
              value={vendorComplaintSubject}
              onChange={(e) => setVendorComplaintSubject(e.target.value)}
              placeholder="Complaint subject..."
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-3 focus:outline-none focus:border-orange-400"
            />
            <textarea
              value={vendorComplaintDesc}
              onChange={(e) => setVendorComplaintDesc(e.target.value)}
              placeholder="Describe your complaint..."
              rows={4}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm mb-4 resize-none focus:outline-none focus:border-orange-400"
            />
            <div className="flex gap-3">
              <button
                onClick={submitVendorComplaint}
                disabled={!vendorComplaintSubject || !vendorComplaintDesc}
                className="flex-1 py-3 rounded-full font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: '#F97316' }}
              >
                Submit Complaint
              </button>
              <button
                onClick={() => {
                  setShowVendorComplaintModal(false);
                  setVendorComplaintSubject('');
                  setVendorComplaintDesc('');
                }}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Tracking Timeline Modal ──────────────────────────── */}
      {trackModal && <TimelineModal order={trackModal} onClose={() => setTrackModal(null)} />}
    </DashboardLayout>
  );
};

export default EquipmentOrdersPage;
