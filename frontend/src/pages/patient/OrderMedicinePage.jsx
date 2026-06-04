import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiPlus, FiMinus, FiX, FiSearch } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import { pageVariants, cardVariants, cardHover } from '../../components/dashboard/variants';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { openRazorpay } from '../../utils/payment';

const API_HOST = 'http://localhost:8000';

const CATEGORY_EMOJI = {
  tablet: '💊', syrup: '🧴', injection: '💉', cream: '🧴', drops: '👁️', capsule: '💊', other: '🏥',
};

const CATEGORY_FILTERS = [
  { value: '', label: 'All' },
  { value: 'tablet', label: '💊 Tablet' },
  { value: 'syrup', label: '🧴 Syrup' },
  { value: 'injection', label: '💉 Injection' },
  { value: 'capsule', label: '💊 Capsule' },
  { value: 'cream', label: '🧴 Cream' },
  { value: 'drops', label: '👁️ Drops' },
];

const imgUrl = (path) => {
  if (!path) return '';
  return path.startsWith('http') ? path : `${API_HOST}${path}`;
};

// Max strips of a single medicine allowed in one order (matches backend).
const MAX_STRIPS_PER_ORDER = 3;

const MedicineCard = ({ medicine, inCart, cartQuantity, hasRx, onAddToCart, onUpdateQuantity, monthlyUsed = 0, monthlyLimit = 10 }) => {
  const expiringSoon = medicine.days_to_expiry != null && medicine.days_to_expiry <= 30;
  const outOfStock = medicine.stock_quantity === 0;

  return (
    <motion.div
      variants={cardVariants}
      whileHover={cardHover}
      className="bg-white rounded-2xl border border-hairline overflow-hidden"
    >
      <div className="relative h-32 bg-gradient-to-br from-orange-50 to-cream flex items-center justify-center">
        {medicine.medicine_image && (
          <img
            src={imgUrl(medicine.medicine_image)}
            alt={medicine.medicine_name}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.target.style.display = 'none';
              if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
            }}
          />
        )}
        <div
          className="absolute inset-0 flex items-center justify-center text-5xl"
          style={{ display: medicine.medicine_image ? 'none' : 'flex' }}
        >
          {CATEGORY_EMOJI[medicine.category] || '💊'}
        </div>
        <div className="absolute top-2 left-2 flex flex-col gap-1 items-start">
          {medicine.requires_prescription && (
            <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-medium">Prescription Required</span>
          )}
          {expiringSoon && (
            <span className="bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full">Exp. soon</span>
          )}
        </div>
      </div>

      <div className="p-3">
        <h3 className="font-semibold text-ink text-sm leading-tight mb-1 line-clamp-2">{medicine.medicine_name}</h3>
        {medicine.generic_name && (
          <p className="text-xs text-gray-400 mb-1 line-clamp-1">{medicine.generic_name}</p>
        )}

        {/* Doctor-prescription indicator — does the patient already have an Rx for this? */}
        {hasRx ? (
          <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium inline-flex items-center gap-1 mb-2">
            ✓ Prescribed
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-500 font-medium inline-flex items-center gap-1 mb-2">
            No Prescription
          </span>
        )}

        <div className="flex items-center gap-1 mb-2 bg-blue-50 rounded-lg px-2 py-1 w-fit max-w-full">
          <span className="text-xs">🏥</span>
          <span className="text-xs text-blue-700 font-medium line-clamp-1">{medicine.pharmacy_name}</span>
        </div>
        {medicine.expiry_date && <p className="text-xs text-gray-400 mb-1">📅 Exp: {medicine.expiry_date}</p>}
        {/* Patients only see availability as a badge — never the raw stock count. */}
        <span
          className="text-xs px-2.5 py-1 rounded-full font-semibold mb-2 inline-block"
          style={{
            backgroundColor: outOfStock ? '#FEF2F2' : '#F0FDF4',
            color: outOfStock ? '#EF4444' : '#16A34A',
          }}
        >
          {outOfStock ? '✗ Out of Stock' : '✓ In Stock'}
        </span>

        {/* Strip pricing — 1 strip = 10 units */}
        <div className="mb-2 rounded-lg px-2 py-1.5" style={{ backgroundColor: '#FFF7ED' }}>
          <p className="font-bricolage text-base font-extrabold" style={{ color: '#F97316' }}>
            ₹{medicine.price_per_unit}
            <span className="text-[11px] text-gray-400 font-normal"> / strip</span>
          </p>
          <p className="text-[11px] text-gray-500">
            1 strip = 10 {medicine.unit || 'units'} · ₹{(Number(medicine.price_per_unit || 0) / 10).toFixed(2)}/{medicine.unit || 'unit'}
          </p>
        </div>

        {/* Monthly usage bar (this medicine, this month) */}
        {monthlyUsed > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#E5E5E5' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (monthlyUsed / monthlyLimit) * 100)}%`,
                  backgroundColor: monthlyUsed >= 8 ? '#EF4444' : monthlyUsed >= 5 ? '#F97316' : '#22C55E',
                }}
              />
            </div>
            <span className="text-[10px] text-gray-400 flex-shrink-0">{monthlyUsed}/{monthlyLimit} this month</span>
          </div>
        )}

        {/* Add / quantity (max 3 strips per order) */}
        <div className="flex items-center justify-end mt-1">
          {!inCart ? (
            <button
              onClick={() => onAddToCart(medicine)}
              disabled={outOfStock}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                outOfStock ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-ink text-white hover:bg-black/80'
              }`}
            >
              {outOfStock ? 'Out of Stock' : 'Add +'}
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => onUpdateQuantity(medicine, -1)} className="w-6 h-6 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm">−</button>
              <span className="font-bold text-orange-600 w-5 text-center text-sm">{cartQuantity}</span>
              <button onClick={() => onUpdateQuantity(medicine, 1)} className="w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-sm">+</button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const OrderMedicinePage = () => {
  const { user } = useAuth();

  const [catalog, setCatalog] = useState([]);
  const [pharmacies, setPharmacies] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [prescriptions, setPrescriptions] = useState([]);
  const [monthlyUsage, setMonthlyUsage] = useState({});

  const [search, setSearch] = useState('');
  const [selectedPharmacy, setSelectedPharmacy] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showRxOnly, setShowRxOnly] = useState(false);

  const [cart, setCart] = useState([]);
  const [address, setAddress] = useState('');
  const [deliveryPhone, setDeliveryPhone] = useState('');
  const [placing, setPlacing] = useState(false);
  const [showCartModal, setShowCartModal] = useState(false);

  const [prescriptionFile, setPrescriptionFile] = useState(null);
  const [prescriptionPreview, setPrescriptionPreview] = useState(null);

  const [approvedOrderData, setApprovedOrderData] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  // `silent` is used by the 60s background refresh: it updates stock WITHOUT
  // flipping the loading flag (which would replace the whole grid with a
  // "Loading…" placeholder and jump the scroll to the top — the auto-refresh bug).
  const loadCatalog = useCallback(async (silent = false) => {
    if (!silent) setCatalogLoading(true);
    try {
      const { data } = await API.get('/api/pharmacy/all-catalog/');
      setCatalog(data?.data || []);
      setPharmacies(data?.pharmacies || []);
    } catch {
      if (!silent) toast.error('Could not load medicines');
    } finally {
      if (!silent) setCatalogLoading(false);
    }
  }, []);

  const fetchPrescriptions = useCallback(async () => {
    try {
      const { data } = await API.get('/api/patient/prescriptions/');
      if (data?.success) setPrescriptions(data.data || []);
    } catch (err) {
      // Best-effort — the page still works without prescription badges.
      console.log(err);
    }
  }, []);

  // Per-medicine strips ordered this month (keyed by inventory_id) — powers the
  // "X/10 this month" bar and mirrors the backend monthly cap.
  const fetchMonthlyUsage = useCallback(async () => {
    try {
      const { data } = await API.get('/api/patient/medicine/monthly-usage/');
      if (data?.success) setMonthlyUsage(data.data?.usage || {});
    } catch {
      /* best-effort — bars just won't show */
    }
  }, []);

  // Initial load + refresh stock every 60s so availability stays current.
  useEffect(() => {
    loadCatalog();
    fetchPrescriptions();
    fetchMonthlyUsage();
    const id = setInterval(() => loadCatalog(true), 60000);
    return () => clearInterval(id);
  }, [loadCatalog, fetchPrescriptions, fetchMonthlyUsage]);

  // True when the patient already has a doctor's prescription that lists this
  // medicine (loose two-way name match — handles brand vs generic naming).
  const hasPrescription = (medicineName) => {
    if (!medicineName) return false;
    const target = medicineName.toLowerCase();
    return prescriptions.some((rx) =>
      rx.medicines?.some((med) => {
        const name = med.name?.toLowerCase();
        if (!name) return false;
        return name.includes(target) || target.includes(name);
      }),
    );
  };

  useEffect(() => {
    const loginId = user?.login_id;
    if (!loginId) return undefined;

    let ws;
    try {
      ws = new WebSocket(`ws://localhost:8000/ws/medicine/${loginId}/`);
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        if (msg.type === 'prescription_approved') {
          toast.success('✅ Prescription approved! You can now pay.');
          setApprovedOrderData({
            orderId: msg.data.order_id,
            razorpayOrderId: msg.data.razorpay_order_id,
            amount: msg.data.amount,
            keyId: msg.data.key_id,
          });
          setShowPaymentModal(true);
        } else if (msg.type === 'prescription_rejected') {
          toast.error(`❌ Prescription rejected: ${msg.data.reason}`);
        } else if (msg.type === 'order_dispatched') {
          toast.success(`🚚 ${msg.data.message}`);
        }
      };
      ws.onerror = () => { /* best-effort — page still works without WS */ };
    } catch {
      /* WebSocket unavailable */
    }
    return () => { try { ws?.close(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login_id]);

  // Live catalog updates broadcast by pharmacists (hide/show, out-of-stock,
  // stock change) via ws/pharmacy/ — the list reflects them with no refresh.
  useEffect(() => {
    let ws;
    let reconnectTimer;
    let closed = false;

    const connect = () => {
      try {
        ws = new WebSocket('ws://localhost:8000/ws/pharmacy/');
      } catch {
        return; // 60s catalog poll still keeps things fresh.
      }
      ws.onmessage = (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type !== 'medicine_updated') return;
        const u = msg.data || {};
        const sameId = (m) => String(m.inventory_id) === String(u.inventory_id);

        if (u.type === 'visibility_changed') {
          if (u.is_listed) {
            loadCatalog(true); // re-listed → silently pull it back into the list
          } else {
            setCatalog((prev) => prev.filter((m) => !sameId(m))); // hidden → drop instantly
          }
        } else if (u.type === 'out_of_stock') {
          setCatalog((prev) => prev.map((m) => (sameId(m)
            ? { ...m, stock_quantity: 0, available_quantity: 0, available_units: 0, in_stock: false }
            : m)));
        } else if (u.type === 'stock_updated') {
          const avail = Number(u.available_quantity ?? 0);
          setCatalog((prev) => prev.map((m) => (sameId(m)
            ? { ...m, stock_quantity: avail, available_quantity: avail, available_units: avail, in_stock: avail > 0 }
            : m)));
        }
      };
      ws.onclose = () => {
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
  }, []);

  const filteredMedicines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalog.filter((m) => {
      if (q && !`${m.medicine_name} ${m.generic_name}`.toLowerCase().includes(q)) return false;
      if (selectedPharmacy && m.pharmacy_id !== selectedPharmacy) return false;
      if (categoryFilter && m.category !== categoryFilter) return false;
      if (showRxOnly && !m.requires_prescription) return false;
      return true;
    });
  }, [catalog, search, selectedPharmacy, categoryFilter, showRxOnly]);

  const cartTotal = cart.reduce((s, m) => s + m.price * m.quantity, 0);
  const cartCount = cart.reduce((s, m) => s + m.quantity, 0);
  const cartHasRx = cart.some((m) => m.requires_prescription);

  const isInCart = (m) => cart.some((x) => x.inventory_id === m.inventory_id);
  const getCartQuantity = (m) => cart.find((x) => x.inventory_id === m.inventory_id)?.quantity || 0;

  const groupedCart = useMemo(() => {
    const map = {};
    cart.forEach((item) => {
      if (!map[item.pharmacy_id]) {
        map[item.pharmacy_id] = { pharmacy_id: item.pharmacy_id, pharmacy_name: item.pharmacy_name, medicines: [] };
      }
      map[item.pharmacy_id].medicines.push(item);
    });
    return Object.values(map);
  }, [cart]);

  const addToCart = (m) => {
    setCart((cur) => {
      const found = cur.find((x) => x.inventory_id === m.inventory_id);
      if (found) {
        if (found.quantity >= MAX_STRIPS_PER_ORDER) {
          toast.error(`Max ${MAX_STRIPS_PER_ORDER} strips per medicine per order — place a separate order for more.`);
          return cur;
        }
        return cur.map((x) =>
          x.inventory_id === m.inventory_id
            ? { ...x, quantity: Math.min(x.quantity + 1, m.stock_quantity, MAX_STRIPS_PER_ORDER) }
            : x);
      }
      return [...cur, {
        inventory_id: m.inventory_id,
        name: m.medicine_name,
        price: m.price_per_unit,
        quantity: 1,
        stock: m.stock_quantity,
        requires_prescription: m.requires_prescription,
        pharmacy_id: m.pharmacy_id,
        pharmacy_name: m.pharmacy_name,
        category: m.category,
      }];
    });
  };

  const updateQuantity = (m, delta) => {
    setCart((cur) => cur
      .map((x) => (x.inventory_id === m.inventory_id
        ? { ...x, quantity: Math.max(1, Math.min(x.quantity + delta, x.stock, MAX_STRIPS_PER_ORDER)) }
        : x)));
  };

  const removeFromCart = (invId) => setCart((cur) => cur.filter((x) => x.inventory_id !== invId));

  const handlePrescriptionSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPrescriptionFile(file);
    setPrescriptionPreview(file.type.includes('image') ? URL.createObjectURL(file) : null);
  };

  const uploadPrescriptionFile = async (orderId, file) => {
    const fd = new FormData();
    fd.append('order_id', orderId);
    fd.append('prescription', file);
    await API.post('/api/patient/medicine/upload-prescription/', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  };

  const payNow = ({ orderId, razorpayOrderId, amount, keyId }) => {
    if (!razorpayOrderId || !keyId) {
      return toast.error('Payment is not ready yet. Please refresh.');
    }
    openRazorpay({
      orderId: razorpayOrderId,
      amount,
      keyId,
      paymentType: 'medicine',
      objectId: orderId,
      user,
      description: 'Medicine order',
      onSuccess: () => {
        toast.success('Medicine order confirmed! Track it under "My Orders".');
      },
    });
  };

  const placeOrder = async () => {
    if (cart.length === 0) return toast.error('Add medicines to your cart');
    if (deliveryPhone.length !== 10) return toast.error('Enter a valid 10-digit delivery phone number');
    if (!address.trim()) return toast.error('Enter a delivery address');
    if (cartHasRx && !prescriptionFile) {
      return toast.error("Upload the doctor's prescription before placing the order");
    }
    setPlacing(true);
    try {
      const { data } = await API.post('/api/patient/medicine/order/', {
        medicines: cart.map((m) => ({
          inventory_id: m.inventory_id,
          name: m.name,
          quantity: m.quantity,
          price: m.price,
          requires_prescription: m.requires_prescription,
        })),
        delivery_address: address,
        delivery_phone: `+91${deliveryPhone}`,
      });
      const placedOrders = data?.data?.orders || [];
      const rxOrders = placedOrders.filter((o) => o.requires_prescription);
      const nonRxOrders = placedOrders.filter((o) => !o.requires_prescription);

      if (rxOrders.length && prescriptionFile) {
        for (const o of rxOrders) {
          // eslint-disable-next-line no-await-in-loop
          await uploadPrescriptionFile(o.order_id, prescriptionFile);
        }
      }

      setCart([]);
      setAddress('');
      setPrescriptionFile(null);
      setPrescriptionPreview(null);
      setShowCartModal(false);
      fetchMonthlyUsage();

      if (rxOrders.length) {
        toast.success('Order placed — prescription sent for pharmacist approval');
      }
      if (nonRxOrders.length === 1 && rxOrders.length === 0) {
        toast.success('Order placed — complete payment to confirm');
        payNow({
          orderId: nonRxOrders[0].order_id,
          razorpayOrderId: nonRxOrders[0].razorpay_order_id,
          amount: nonRxOrders[0].amount,
          keyId: nonRxOrders[0].key_id,
        });
      } else if (nonRxOrders.length) {
        toast('Complete payment for your orders in "My Orders" below 💳');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not place order');
    } finally {
      setPlacing(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('');
    setSelectedPharmacy('');
    setShowRxOnly(false);
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <motion.div variants={cardVariants} className="mb-6">
          <h1 className="font-bricolage text-3xl font-extrabold text-ink">Order Medicine</h1>
          <p className="text-muted mt-1">Browse medicines from every approved pharmacy.</p>
        </motion.div>

        {/* Browse */}
        <section className="mb-10 pb-24">
          {/* Search */}
          <div className="relative max-w-xl mb-4">
            <FiSearch className="absolute left-4 top-1/2 -translate-y-1/2 text-orange-500 w-4 h-4" />
            <input
              className="w-full bg-white border border-hairline rounded-full pl-11 pr-4 py-3 text-sm focus:outline-none focus:border-orange-400 transition"
              placeholder="Search medicines…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Pharmacy pills */}
          {pharmacies.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={() => setSelectedPharmacy('')}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${
                  !selectedPharmacy ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-muted border-hairline hover:border-orange-400'
                }`}
              >
                All Pharmacies
              </button>
              {pharmacies.map((p) => (
                <button
                  key={p.pharmacy_id}
                  onClick={() => setSelectedPharmacy(p.pharmacy_id)}
                  className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${
                    selectedPharmacy === p.pharmacy_id ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-muted border-hairline hover:border-orange-400'
                  }`}
                >
                  {p.pharmacy_name}
                </button>
              ))}
            </div>
          )}

          {/* Category pills + Rx toggle */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORY_FILTERS.map((c) => (
              <button
                key={c.value}
                onClick={() => setCategoryFilter(c.value)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${
                  categoryFilter === c.value ? 'bg-ink text-white border-ink' : 'bg-white text-muted border-hairline hover:border-gray-300'
                }`}
              >
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setShowRxOnly((v) => !v)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-semibold border transition ${
                showRxOnly ? 'bg-red-500 text-white border-red-500' : 'bg-white text-muted border-hairline hover:border-red-300'
              }`}
            >
              🔴 Prescription Only
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
            <p className="text-sm text-muted">
              Showing {filteredMedicines.length} medicines from {pharmacies.length} pharmacies
            </p>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-gray-400">Stock updates every minute</span>
            </div>
          </div>

          {catalogLoading ? (
            <p className="text-sm text-muted">Loading medicines…</p>
          ) : filteredMedicines.length === 0 ? (
            <div className="text-center py-12">
              <span className="text-5xl">💊</span>
              <p className="text-muted mt-3">No medicines found</p>
              <button onClick={clearFilters} className="text-orange-500 text-sm mt-2 underline">Clear filters</button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredMedicines.map((medicine) => (
                <MedicineCard
                  key={medicine.inventory_id}
                  medicine={medicine}
                  inCart={isInCart(medicine)}
                  cartQuantity={getCartQuantity(medicine)}
                  hasRx={hasPrescription(medicine.medicine_name)}
                  onAddToCart={addToCart}
                  onUpdateQuantity={updateQuantity}
                  monthlyUsed={monthlyUsage[medicine.inventory_id] || 0}
                  monthlyLimit={10}
                />
              ))}
            </div>
          )}
        </section>
      </motion.div>

      {/* Fixed bottom cart bar */}
      <AnimatePresence>
        {cart.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 24 }}
            className="fixed bottom-0 left-0 right-0 bg-white border-t border-hairline shadow-[0_-8px_30px_rgba(0,0,0,0.08)] p-4 z-40"
          >
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold text-ink">{cartCount} items</p>
                <p className="font-bricolage text-orange-500 font-extrabold text-lg">₹{cartTotal.toFixed(2)}</p>
              </div>
              {cartHasRx && <span className="text-xs text-red-500 font-medium">⚠️ Prescription required</span>}
              <button onClick={() => setShowCartModal(true)} className="btn-orange">Checkout →</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart modal */}
      <Modal isOpen={showCartModal} onClose={() => setShowCartModal(false)} title="Your Cart">
        <div className="space-y-4">
          {cart.filter((m) => m.requires_prescription).length > 1 && (
            <div style={{ backgroundColor: '#FFF7ED', border: '1.5px solid #FED7AA', borderRadius: 12, padding: 16 }}>
              <p style={{ fontWeight: 700, color: '#F97316', fontSize: 14, margin: '0 0 6px' }}>
                ⚠️ Multiple Prescription Medicines
              </p>
              <p style={{ color: '#666', fontSize: 13, lineHeight: 1.5, margin: '0 0 12px' }}>
                You have {cart.filter((m) => m.requires_prescription).length} prescription medicines in your cart.
                Each prescription medicine requires its own prescription upload — they may not all be covered by a single uploaded file.
              </p>
              <p style={{ color: '#333', fontSize: 13, fontWeight: 600, margin: 0 }}>
                💡 Tip: order one prescription medicine at a time, or combine only medicines that are on the SAME prescription.
              </p>
            </div>
          )}

          {groupedCart.map((group) => {
            const groupTotal = group.medicines.reduce((s, m) => s + m.price * m.quantity, 0);
            return (
              <div key={group.pharmacy_id}>
                <div className="flex items-center gap-2 mb-2">
                  <span>🏥</span>
                  <h4 className="font-semibold text-ink">{group.pharmacy_name}</h4>
                </div>
                <div className="space-y-2">
                  {group.medicines.map((item) => (
                    <div key={item.inventory_id} className="bg-cream border border-hairline rounded-xl p-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ink truncate">
                          {item.name}
                          {item.requires_prescription && <span className="ml-1 text-xs text-red-500">Prescription</span>}
                        </span>
                        <button onClick={() => removeFromCart(item.inventory_id)} className="text-gray-400 hover:text-red-500"><FiX /></button>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center gap-2">
                          <button onClick={() => updateQuantity(item, -1)} className="w-6 h-6 rounded bg-orange-100 text-orange-600"><FiMinus className="mx-auto w-3 h-3" /></button>
                          <span>{item.quantity}</span>
                          <button onClick={() => updateQuantity(item, 1)} className="w-6 h-6 rounded bg-orange-500 text-white"><FiPlus className="mx-auto w-3 h-3" /></button>
                        </div>
                        <span className="text-muted">₹{item.price * item.quantity}</span>
                      </div>

                      {/* Doctor-prescription info for this medicine */}
                      {hasPrescription(item.name) ? (
                        <div className="bg-green-50 rounded-xl p-3 mt-2 border border-green-100">
                          <p className="text-sm font-medium text-green-700">✓ Doctor Prescribed Medicine</p>
                          <p className="text-xs text-green-600 mt-1">
                            This medicine was prescribed by your doctor. Dosage and duration instructions are in your prescription.
                          </p>
                        </div>
                      ) : (
                        <div
                          className="rounded-xl p-3 mt-2 border"
                          style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
                        >
                          <p className="text-sm font-medium" style={{ color: '#F97316' }}>⚠️ No Active Prescription</p>
                          <p className="text-xs text-gray-500 mt-1">
                            This medicine has no active doctor prescription. Please consult a doctor first.
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-right text-xs text-muted mt-1">Pharmacy subtotal: ₹{groupTotal.toFixed(2)}</div>
              </div>
            );
          })}

          <div className="text-right font-bricolage font-extrabold text-ink border-t border-hairline pt-2">
            Grand Total: ₹{cartTotal.toFixed(2)}
          </div>
          {groupedCart.length > 1 && (
            <p className="text-xs text-muted">
              ℹ️ Your cart has medicines from {groupedCart.length} pharmacies — a separate order is created for each pharmacy.
            </p>
          )}

          <div>
            <p className="font-medium text-ink mb-1 text-sm">📞 Contact Number for Delivery *</p>
            <div className="flex rounded-xl overflow-hidden" style={{ border: '1.5px solid #E5E5E5' }}>
              <span className="px-3 flex items-center text-sm font-semibold flex-shrink-0" style={{ backgroundColor: '#F9FAFB', borderRight: '1px solid #E5E5E5', color: '#333' }}>
                🇮🇳 +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                className="flex-1 px-3.5 py-2.5 text-sm outline-none"
                placeholder="Enter 10-digit number"
                maxLength={10}
                value={deliveryPhone}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  if (digits.length <= 10) setDeliveryPhone(digits);
                }}
              />
              <span className="px-3 flex items-center text-[11px] flex-shrink-0" style={{ color: deliveryPhone.length === 10 ? '#22C55E' : '#9CA3AF' }}>
                {deliveryPhone.length}/10{deliveryPhone.length === 10 ? ' ✓' : ''}
              </span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">Pharmacist will call this number during delivery.</p>
          </div>

          <div>
            <p className="font-medium text-ink mb-1 text-sm">📍 Delivery Address *</p>
            <textarea
              className="input-field h-20 resize-none w-full"
              placeholder="Full delivery address…"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          {cartHasRx && (
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">⚕️</span>
                <div>
                  <p className="font-semibold text-orange-800">Prescription Required</p>
                  <p className="text-xs text-orange-600">
                    Required for: {cart.filter((m) => m.requires_prescription).map((m) => m.name).join(', ')}
                  </p>
                </div>
              </div>

              {!prescriptionFile ? (
                <label className="border-2 border-dashed border-orange-400 rounded-xl p-4 text-center cursor-pointer block hover:border-orange-600 transition-colors">
                  <div className="text-3xl mb-2">📄</div>
                  <p className="text-sm font-medium text-orange-700">Upload Doctor's Prescription</p>
                  <p className="text-xs text-orange-500 mt-1">JPG, PNG or PDF accepted</p>
                  <input type="file" accept="image/*,.pdf" onChange={handlePrescriptionSelect} className="hidden" />
                </label>
              ) : (
                <div className="space-y-2">
                  {prescriptionPreview ? (
                    <img src={prescriptionPreview} alt="Prescription preview" className="w-full h-32 object-cover rounded-xl" />
                  ) : (
                    <div className="bg-orange-100 rounded-xl p-3 flex items-center gap-2">
                      <span className="text-2xl">📄</span>
                      <span className="text-sm text-orange-700 truncate">{prescriptionFile.name}</span>
                    </div>
                  )}
                  <button onClick={() => { setPrescriptionFile(null); setPrescriptionPreview(null); }} className="text-xs text-red-500 underline">
                    Remove & choose different file
                  </button>
                </div>
              )}

              <p className="text-xs text-orange-600 mt-2">
                ℹ️ Prescription orders go to the pharmacist for verification. Payment is required only after approval.
              </p>
            </div>
          )}

          <button onClick={placeOrder} disabled={placing} className="btn-orange w-full disabled:opacity-60">
            {placing ? 'Placing order…' : `Place Order — ₹${cartTotal.toFixed(2)}`}
          </button>
        </div>
      </Modal>

      {/* Prescription approved → pay popup */}
      {showPaymentModal && approvedOrderData && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 w-full max-w-sm text-center"
          >
            <div className="text-5xl mb-3">✅</div>
            <h3 className="font-bricolage font-bold text-lg text-green-700 mb-2">Prescription Approved!</h3>
            <p className="text-muted mb-4 text-sm">Your prescription has been verified. Complete payment to confirm your order.</p>
            <button
              onClick={() => { setShowPaymentModal(false); payNow(approvedOrderData); }}
              className="btn-orange w-full mb-2"
            >
              💳 Pay Now
            </button>
            <button onClick={() => setShowPaymentModal(false)} className="text-muted text-sm">Pay later from My Orders</button>
          </motion.div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default OrderMedicinePage;
