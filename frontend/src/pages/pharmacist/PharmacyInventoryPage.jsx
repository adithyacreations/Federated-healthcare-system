import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { FiPackage, FiAlertTriangle, FiXCircle, FiClock, FiPlus, FiSearch } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import StatCard from '../../components/common/StatCard';
import Modal from '../../components/common/Modal';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import LiveIndicator from '../../components/common/LiveIndicator';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';

const CATEGORIES = [
  { value: 'tablet', label: 'Tablet' },
  { value: 'syrup', label: 'Syrup' },
  { value: 'injection', label: 'Injection' },
  { value: 'cream', label: 'Cream/Ointment' },
  { value: 'drops', label: 'Drops' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_EMOJI = {
  tablet: '💊',
  syrup: '🧴',
  injection: '💉',
  cream: '🧴',
  drops: '👁️',
  capsule: '💊',
  other: '🏥',
};

const API_HOST = 'http://localhost:8000';

const EMPTY = {
  medicine_name: '', generic_name: '', category: 'tablet', description: '',
  price_per_unit: '', unit: 'tablet', stock_quantity: '', reorder_level: 10,
  requires_prescription: false, manufacturer: '', expiry_date: '',
};

const todayStr = new Date().toISOString().slice(0, 10);

const itemStatus = (m) => {
  if (m.stock_quantity <= 0) return { key: 'out', label: 'Out of Stock', cls: 'bg-red-100 text-red-700' };
  if (m.expiry_date && m.expiry_date < todayStr) return { key: 'expired', label: 'Expired', cls: 'bg-gray-200 text-gray-600' };
  if (m.stock_quantity <= m.reorder_level) return { key: 'low', label: 'Low Stock', cls: 'bg-orange-100 text-orange-700' };
  return { key: 'available', label: 'Available', cls: 'bg-green-100 text-green-700' };
};

const getExpiryStatus = (expiryDate) => {
  if (!expiryDate) return 'unknown';
  const daysLeft = Math.floor((new Date(expiryDate) - new Date()) / 86400000);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'expiring_soon';
  if (daysLeft <= 90) return 'expiring';
  return 'valid';
};

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Not set';

const MedicineCard = ({ m, onEdit, onDelete, onToggle, onImageUpload }) => {
  const reserved = m.reserved_quantity || 0;
  const available = m.available_quantity ?? Math.max(0, m.stock_quantity - reserved);
  const isLowStock = available > 0 && available <= (m.reorder_level || 10);
  const expiryState = getExpiryStatus(m.expiry_date);
  const isExpired = expiryState === 'expired';
  const isExpiringSoon = expiryState === 'expiring_soon';

  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-lg transition-all duration-200">
      {/* Image / icon */}
      <label className="relative h-36 flex items-center justify-center cursor-pointer block" style={{ backgroundColor: '#FFF7ED' }} title="Click to upload photo">
        {m.medicine_image ? (
          <img src={`${API_HOST}${m.medicine_image}`} alt={m.medicine_name} className="w-full h-full object-cover" />
        ) : (
          <span className="text-6xl">{CATEGORY_EMOJI[m.category] || '💊'}</span>
        )}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => onImageUpload(m.inventory_id, e.target.files?.[0])}
        />

        {/* Stock / expiry badge */}
        <div className="absolute top-2 right-2">
          {isExpired ? (
            <span className="bg-black text-white text-xs px-2 py-1 rounded-full font-medium">Expired!</span>
          ) : isExpiringSoon ? (
            <span className="text-white text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: '#F97316' }}>Expiring Soon!</span>
          ) : available <= 0 ? (
            <span className="bg-red-500 text-white text-xs px-2 py-1 rounded-full font-medium">Out of Stock</span>
          ) : isLowStock ? (
            <span className="text-white text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: '#F97316' }}>Low Stock</span>
          ) : (
            <span className="bg-black/60 text-white text-xs px-2 py-1 rounded-full">In Stock</span>
          )}
        </div>

        {/* Prescription badge */}
        {m.requires_prescription && (
          <div className="absolute top-2 left-2">
            <span className="text-white text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: '#000000' }}>Prescription</span>
          </div>
        )}
      </label>

      {/* Body */}
      <div className="p-4">
        <h3 className="font-bold text-base text-black mb-1 line-clamp-1">{m.medicine_name}</h3>
        <p className="text-xs text-gray-400 mb-2 line-clamp-1">{m.generic_name || ' '}</p>

        <span className="text-xs px-2 py-1 rounded-full font-medium capitalize mb-3 inline-block" style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}>
          {m.category || 'Medicine'}
        </span>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-2">
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-xs text-gray-500">Total</p>
            <p className="font-bold text-lg text-black">{m.stock_quantity}</p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-xs text-gray-500">Available</p>
            <p
              className={`font-bold text-lg ${
                available === 0 ? 'text-red-500' : available <= 5 ? 'text-orange-500' : 'text-black'
              }`}
            >
              {available}
            </p>
          </div>
          <div className="bg-gray-50 rounded-xl p-2 text-center">
            <p className="text-xs text-gray-500">Price</p>
            <p className="font-bold text-base" style={{ color: '#F97316' }}>₹{m.price_per_unit}</p>
          </div>
        </div>
        {m.reserved_display && (
          <div className="bg-orange-50 rounded-xl p-2 text-center mb-3">
            <p className="text-xs" style={{ color: '#F97316' }}>⏳ {m.reserved_display}</p>
          </div>
        )}

        {/* Expiry */}
        <div
          className={`text-xs px-3 py-2 rounded-xl mb-3 flex items-center justify-between ${
            isExpired ? 'bg-red-50 text-red-600' : isExpiringSoon ? 'bg-orange-50 text-orange-600' : 'bg-gray-50 text-gray-500'
          }`}
        >
          <span>📅 Expiry:</span>
          <span className="font-medium">{fmtDate(m.expiry_date)}</span>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mb-2">
          <button onClick={() => onEdit(m)} className="flex-1 py-2 rounded-full text-sm font-medium text-white" style={{ backgroundColor: '#F97316' }}>
            Edit
          </button>
          <button onClick={() => onDelete(m.inventory_id)} className="flex-1 py-2 rounded-full text-sm font-medium bg-black text-white">
            Delete
          </button>
        </div>
        <button
          onClick={() => onToggle(m)}
          className={`w-full py-1.5 rounded-full text-xs font-medium ${m.is_available ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}
        >
          {m.is_available ? 'Listed — tap to hide' : 'Hidden — tap to list'}
        </button>
      </div>
    </div>
  );
};

const PharmacyInventoryPage = () => {
  const { data, loading, refetch, refreshing, lastUpdated } = useApi(
    '/api/pharmacy/inventory/', { pollInterval: 30000 },
  );
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);   // inventory_id being edited
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null);

  const stats = data?.stats || { total: 0, low_stock: 0, out_of_stock: 0, expired: 0 };
  const medicines = useMemo(() => data?.medicines || [], [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return medicines.filter((m) => {
      if (q && !`${m.medicine_name} ${m.generic_name}`.toLowerCase().includes(q)) return false;
      if (catFilter !== 'all' && m.category !== catFilter) return false;
      if (statusFilter !== 'all' && itemStatus(m).key !== statusFilter) return false;
      return true;
    });
  }, [medicines, search, catFilter, statusFilter]);

  const openAdd = () => { setEditing(null); setForm(EMPTY); setModalOpen(true); };
  const openEdit = (m) => {
    setEditing(m.inventory_id);
    setForm({ ...EMPTY, ...m, expiry_date: m.expiry_date || '' });
    setModalOpen(true);
  };

  const save = async () => {
    if (!form.medicine_name.trim()) return toast.error('Medicine name is required');
    setSaving(true);
    try {
      const body = {
        ...form,
        price_per_unit: Number(form.price_per_unit) || 0,
        stock_quantity: Number(form.stock_quantity) || 0,
        reorder_level: Number(form.reorder_level) || 0,
        expiry_date: form.expiry_date || null,
      };
      if (editing) {
        await API.put(`/api/pharmacy/inventory/${editing}/`, body);
        toast.success('Medicine updated');
      } else {
        await API.post('/api/pharmacy/inventory/', body);
        toast.success('Medicine added');
      }
      setModalOpen(false);
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async (m) => {
    try {
      await API.put(`/api/pharmacy/inventory/${m.inventory_id}/`, { is_available: !m.is_available });
      refetch();
    } catch {
      toast.error('Could not update availability');
    }
  };

  const doDelete = async () => {
    try {
      await API.delete(`/api/pharmacy/inventory/${deleteId}/`);
      toast.success('Medicine removed');
      setDeleteId(null);
      refetch();
    } catch {
      toast.error('Delete failed');
    }
  };

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleMedicineImageUpload = async (itemId, file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('image', file);
    try {
      await API.post(`/api/pharmacy/inventory/${itemId}/upload-image/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      toast.success('Medicine image uploaded!');
      refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Image upload failed');
    }
  };

  return (
    <DashboardLayout>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-primary">Pharmacy Inventory</h1>
        <div className="flex items-center gap-3">
          <LiveIndicator refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refetch} />
          <button onClick={openAdd} className="btn-primary inline-flex items-center gap-1.5 text-sm">
            <FiPlus className="w-4 h-4" /> Add Medicine
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total Medicines" value={stats.total} icon={FiPackage} color="info" />
        <StatCard title="Low Stock" value={stats.low_stock} icon={FiAlertTriangle} color="warning" />
        <StatCard title="Out of Stock" value={stats.out_of_stock} icon={FiXCircle} color="danger" />
        <StatCard title="Expired" value={stats.expired} icon={FiClock} color="primary" />
      </div>

      {/* Filters */}
      <div className="card mb-5 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            className="input-field pl-9 w-full"
            placeholder="Search medicines…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="input-field w-44" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select className="input-field w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All status</option>
          <option value="available">Available</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Expiry warning banners */}
      {medicines.some((m) => getExpiryStatus(m.expiry_date) === 'expired') && (
        <div className="bg-black text-white rounded-xl p-4 mb-4 flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <p className="font-semibold">Expired Medicines!</p>
            <p className="text-sm text-gray-300">
              {medicines.filter((m) => getExpiryStatus(m.expiry_date) === 'expired').length} medicine(s) have expired. Please remove them immediately.
            </p>
          </div>
        </div>
      )}
      {medicines.some((m) => getExpiryStatus(m.expiry_date) === 'expiring_soon') && (
        <div className="rounded-xl p-4 mb-4 flex items-center gap-3" style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}>
          <span className="text-2xl">⏰</span>
          <div>
            <p className="font-semibold" style={{ color: '#F97316' }}>Expiring Soon!</p>
            <p className="text-sm text-gray-500">
              {medicines.filter((m) => getExpiryStatus(m.expiry_date) === 'expiring_soon').length} medicine(s) expiring within 30 days.
            </p>
          </div>
        </div>
      )}

      {/* Card grid */}
      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading inventory…</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-10 text-gray-400">No medicines found</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((m) => (
            <MedicineCard
              key={m.inventory_id}
              m={m}
              onEdit={openEdit}
              onDelete={setDeleteId}
              onToggle={toggleAvailability}
              onImageUpload={handleMedicineImageUpload}
            />
          ))}
        </div>
      )}

      {/* Add / Edit modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Medicine' : 'Add Medicine'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Medicine Name *</label>
            <input className="input-field" value={form.medicine_name} onChange={(e) => set('medicine_name', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Generic Name</label>
            <input className="input-field" value={form.generic_name} onChange={(e) => set('generic_name', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Category</label>
            <select className="input-field" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Description</label>
            <textarea className="input-field h-16 resize-none" value={form.description} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Price per unit (₹)</label>
            <input type="number" className="input-field" value={form.price_per_unit} onChange={(e) => set('price_per_unit', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Unit</label>
            <input className="input-field" value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="tablet / ml / unit" />
          </div>
          <div>
            <label className="text-xs text-gray-500">Stock Quantity</label>
            <input type="number" className="input-field" value={form.stock_quantity} onChange={(e) => set('stock_quantity', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Reorder Level</label>
            <input type="number" className="input-field" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Manufacturer</label>
            <input className="input-field" value={form.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500">Expiry Date</label>
            <input type="date" className="input-field" value={form.expiry_date} onChange={(e) => set('expiry_date', e.target.value)} />
          </div>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.requires_prescription} onChange={(e) => set('requires_prescription', e.target.checked)} />
            Requires Prescription
          </label>
        </div>
        <div className="flex justify-end gap-3 mt-4">
          <button onClick={() => setModalOpen(false)} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">
            {saving ? 'Saving…' : editing ? 'Update' : 'Add Medicine'}
          </button>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(deleteId)}
        onCancel={() => setDeleteId(null)}
        onConfirm={doDelete}
        title="Remove Medicine"
        message="Are you sure you want to remove this medicine from inventory?"
        confirmLabel="Remove"
      />
    </DashboardLayout>
  );
};

export default PharmacyInventoryPage;
