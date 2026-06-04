import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiPackage, FiPlus, FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

// ─── Equipment categories (hospital inventory = equipment only, no medicines) ──
const EQUIPMENT_EMOJI = {
  medical_equipment: '🏥',
  diagnostic: '🔬',
  surgical: '⚕️',
  monitoring: '📊',
  emergency: '🚨',
  laboratory: '🧪',
  imaging: '📷',
  therapy: '💊',
  furniture: '🛏️',
  other: '📦',
};

const CATEGORY_OPTIONS = [
  { value: 'medical_equipment', label: 'Medical Equipment' },
  { value: 'diagnostic', label: 'Diagnostic Equipment' },
  { value: 'surgical', label: 'Surgical Equipment' },
  { value: 'monitoring', label: 'Monitoring Equipment' },
  { value: 'emergency', label: 'Emergency Equipment' },
  { value: 'laboratory', label: 'Laboratory Equipment' },
  { value: 'imaging', label: 'Imaging Equipment' },
  { value: 'therapy', label: 'Therapy Equipment' },
  { value: 'furniture', label: 'Furniture' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_LABEL = (cat) => cat.replace(/_/g, ' ');

const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'out_of_service', label: 'Out of Service' },
];

const CONDITION_STYLES = {
  good: { bg: '#F0FDF4', color: '#16A34A', label: '✅ Good' },
  fair: { bg: '#FFF7ED', color: '#F97316', label: '⚠️ Fair' },
  poor: { bg: '#FEF2F2', color: '#EF4444', label: '❌ Poor' },
  needs_repair: { bg: '#FEF2F2', color: '#EF4444', label: '🔧 Needs Repair' },
  out_of_service: { bg: '#F3F4F6', color: '#9CA3AF', label: '⛔ Out of Service' },
};

const BLANK_FORM = {
  item_name: '',
  category: 'medical_equipment',
  quantity: '',
  unit: '',
  reorder_level: '10',
  condition: 'good',
};

// ─── Stock movement reasons ─────────────────────────────────────────────────
const IN_REASONS = [
  { value: 'purchase', label: '🛒 New Purchase' },
  { value: 'transfer_in', label: '📦 Transfer In' },
  { value: 'donation', label: '🎁 Donation' },
  { value: 'repair_return', label: '🔧 Returned from Repair' },
];

const OUT_REASONS = [
  { value: 'used', label: '✅ Used/Consumed' },
  { value: 'damaged', label: '💔 Damaged' },
  { value: 'repair_out', label: '🔧 Sent for Repair' },
  { value: 'disposed', label: '🗑️ Disposed/Expired' },
  { value: 'transfer_out', label: '📤 Transferred Out' },
  { value: 'lost', label: '❓ Lost/Missing' },
];

const BLANK_STOCK_FORM = {
  quantity: 1,
  reason: '',
  vendor_name: '',
  invoice_number: '',
  notes: '',
  movement_date: new Date().toISOString().split('T')[0],
};

// ─── Equipment Card ─────────────────────────────────────────────────────────
const EquipmentCard = ({ item, onEdit, onDelete, onImageUpload, onAddStock, onRemoveStock, onHistory }) => (
  <div
    className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-lg transition-all duration-200"
    style={{ cursor: 'pointer' }}
  >
    {/* Image / emoji */}
    <div className="relative h-40" style={{ backgroundColor: '#FFF7ED' }}>
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.item_name}
          className="w-full h-full object-cover"
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-6xl">
          {EQUIPMENT_EMOJI[item.category] || '📦'}
        </div>
      )}

      {/* Stock status badge */}
      <div className="absolute top-2 right-2">
        {item.quantity === 0 ? (
          <span className="bg-black text-white text-xs px-2 py-1 rounded-full font-medium">Out of Stock</span>
        ) : item.quantity <= item.reorder_level ? (
          <span className="text-white text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: '#F97316' }}>
            Low Stock
          </span>
        ) : (
          <span className="bg-black/60 text-white text-xs px-2 py-1 rounded-full font-medium">In Stock</span>
        )}
      </div>

      {/* Upload image button */}
      <label className="absolute bottom-2 right-2 cursor-pointer">
        <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center shadow-md text-sm">📷</div>
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onImageUpload(item.inventory_id, e.target.files[0])}
        />
      </label>
    </div>

    {/* Body */}
    <div className="p-4">
      <h3 className="font-bold text-base text-black mb-1 line-clamp-1">{item.item_name}</h3>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <span
          className="text-xs px-2 py-1 rounded-full font-medium capitalize inline-block"
          style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}
        >
          {CATEGORY_LABEL(item.category)}
        </span>
        {(() => {
          const c = CONDITION_STYLES[item.condition] || CONDITION_STYLES.good;
          return (
            <span
              className="text-xs px-2 py-1 rounded-full font-semibold inline-block"
              style={{ backgroundColor: c.bg, color: c.color }}
            >
              {c.label}
            </span>
          );
        })()}
      </div>

      {/* Stock count display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#F9FAFB',
          borderRadius: '10px',
          padding: '10px 14px',
          marginBottom: '10px',
        }}
      >
        <div>
          <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '0 0 2px' }}>Current Stock</p>
          <p
            style={{
              fontSize: '24px',
              fontWeight: '800',
              color: item.quantity === 0
                ? '#EF4444'
                : item.quantity <= item.reorder_level
                  ? '#F97316'
                  : '#000000',
              margin: 0,
            }}
          >
            {item.quantity}
            <span style={{ fontSize: '12px', color: '#9CA3AF', fontWeight: '400', marginLeft: '4px' }}>
              {item.unit || 'units'}
            </span>
          </p>
        </div>

        {(item.quantity === 0 || item.quantity <= item.reorder_level) && (
          <span
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              borderRadius: '999px',
              backgroundColor: item.quantity === 0 ? '#FEF2F2' : '#FFF7ED',
              color: item.quantity === 0 ? '#EF4444' : '#F97316',
              fontWeight: '600',
            }}
          >
            {item.quantity === 0 ? '⛔ Out of Stock' : '⚠️ Low Stock'}
          </span>
        )}
      </div>

      {/* Stock action buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
        <button
          onClick={() => onAddStock(item)}
          style={{
            padding: '10px',
            backgroundColor: '#F0FDF4',
            color: '#16A34A',
            border: '1.5px solid #86EFAC',
            borderRadius: '10px',
            fontWeight: '700',
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          + Add Stock
        </button>

        <button
          onClick={() => onRemoveStock(item)}
          disabled={item.quantity === 0}
          style={{
            padding: '10px',
            backgroundColor: item.quantity === 0 ? '#F3F4F6' : '#FEF2F2',
            color: item.quantity === 0 ? '#9CA3AF' : '#EF4444',
            border: `1.5px solid ${item.quantity === 0 ? '#E5E5E5' : '#FCA5A5'}`,
            borderRadius: '10px',
            fontWeight: '700',
            fontSize: '13px',
            cursor: item.quantity === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          − Remove Stock
        </button>
      </div>

      {/* History button */}
      <button
        onClick={() => onHistory(item)}
        style={{
          width: '100%',
          padding: '8px',
          backgroundColor: 'white',
          color: '#666',
          border: '1px solid #E5E5E5',
          borderRadius: '10px',
          fontSize: '12px',
          fontWeight: '600',
          cursor: 'pointer',
          marginBottom: '10px',
        }}
      >
        📋 View Movement History
      </button>

      <p className="text-xs text-gray-400 mb-2">Reorder at {item.reorder_level} units</p>

      {item.maintenance_due && (
        <p className="text-xs text-gray-500 mb-3">🔧 Maintenance: {item.maintenance_due}</p>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onEdit(item)}
          className="flex-1 py-2 rounded-full text-sm font-medium text-white transition-all"
          style={{ backgroundColor: '#F97316' }}
        >
          Edit Details
        </button>
        <button
          onClick={() => onDelete(item)}
          className="flex-1 py-2 rounded-full text-sm font-medium bg-black text-white transition-all"
        >
          Delete
        </button>
      </div>
    </div>
  </div>
);

const InventoryPage = () => {
  const inventory = useApi('/api/hospital/inventory/');
  const [form, setForm]       = useState(BLANK_FORM);
  const [adding, setAdding]   = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [saving, setSaving]   = useState(false);

  // ── Stock movement state ──────────────────────────────────────────────────
  const [showStockModal, setShowStockModal]   = useState(false);
  const [stockModalType, setStockModalType]   = useState('in');
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [showHistoryModal, setShowHistoryModal]   = useState(false);
  const [stockHistory, setStockHistory]       = useState([]);
  const [stockSaving, setStockSaving]         = useState(false);
  const [stockForm, setStockForm]             = useState(BLANK_STOCK_FORM);

  const items = inventory.data?.items || (Array.isArray(inventory.data) ? inventory.data : []);
  const lowStockCount = inventory.data?.low_stock_count ?? items.filter((i) => i.is_low_stock).length;

  const refetchInventory = () => inventory.refetch();

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.item_name.trim()) { toast.error('Item name is required'); return; }
    if (!form.quantity) { toast.error('Quantity is required'); return; }
    setAdding(true);
    try {
      await API.post('/api/hospital/inventory/add/', {
        item_name: form.item_name.trim(),
        category: form.category,
        quantity: parseInt(form.quantity, 10),
        unit: form.unit,
        reorder_level: parseInt(form.reorder_level || '10', 10),
        condition: form.condition,
      });
      toast.success('Equipment added to inventory');
      refetchInventory();
      setForm(BLANK_FORM);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add item');
    } finally {
      setAdding(false);
    }
  };

  const handleImageUpload = async (itemId, file) => {
    if (!file) return;
    try {
      const formData = new FormData();
      formData.append('image', file);
      const response = await API.post(
        `/api/hospital/inventory/${itemId}/upload-image/`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (response.data.success) {
        toast.success('Image uploaded!');
        refetchInventory();
      }
    } catch {
      toast.error('Upload failed!');
    }
  };

  const handleEdit = (item) => setEditItem({ ...item });

  const handleSaveEdit = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      await API.put(`/api/hospital/inventory/${editItem.inventory_id}/`, {
        item_name: editItem.item_name,
        category: editItem.category,
        reorder_level: parseInt(editItem.reorder_level, 10),
        unit: editItem.unit,
        condition: editItem.condition || 'good',
      });
      toast.success('Equipment updated');
      setEditItem(null);
      refetchInventory();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.item_name}" from inventory?`)) return;
    try {
      await API.delete(`/api/hospital/inventory/${item.inventory_id}/`);
      toast.success('Equipment deleted');
      refetchInventory();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Delete failed');
    }
  };

  // ── Stock movement handlers ───────────────────────────────────────────────
  const openStockModal = (item, type) => {
    setSelectedEquipment(item);
    setStockModalType(type);
    setStockForm({ ...BLANK_STOCK_FORM, reason: type === 'in' ? 'purchase' : 'used' });
    setShowStockModal(true);
  };

  const handleStockMovement = async () => {
    if (!stockForm.quantity || stockForm.quantity <= 0) {
      toast.error('Enter valid quantity!');
      return;
    }
    if (!stockForm.reason) {
      toast.error('Please select a reason!');
      return;
    }
    setStockSaving(true);
    try {
      const response = await API.post(
        `/api/hospital/equipment/${selectedEquipment.inventory_id}/stock/`,
        { movement_type: stockModalType, ...stockForm },
      );
      if (response.data.success) {
        toast.success(response.data.message);
        setShowStockModal(false);
        setStockForm(BLANK_STOCK_FORM);
        refetchInventory();
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed!');
    } finally {
      setStockSaving(false);
    }
  };

  const fetchHistory = async (item) => {
    try {
      const response = await API.get(`/api/hospital/equipment/${item.inventory_id}/stock/`);
      if (response.data.success) {
        setStockHistory(response.data.data.movements);
        setSelectedEquipment(item);
        setShowHistoryModal(true);
      }
    } catch {
      toast.error('Failed to load history!');
    }
  };

  // Live preview of the count after the pending movement is applied.
  const previewQty = selectedEquipment
    ? (stockModalType === 'in'
        ? selectedEquipment.quantity + (parseInt(stockForm.quantity, 10) || 0)
        : Math.max(0, selectedEquipment.quantity - (parseInt(stockForm.quantity, 10) || 0)))
    : 0;

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Equipment Inventory</h1>
          <p className="text-sm text-gray-500">Track medical equipment, devices, and assets</p>
        </div>
        <button
          onClick={refetchInventory}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-orange-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ─── Stats ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-4">
          <div className="text-3xl font-bold text-black">{items.length}</div>
          <div className="text-xs text-gray-500 mt-1">Total Equipment</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-4">
          <div className="text-3xl font-bold" style={{ color: lowStockCount > 0 ? '#F97316' : '#000' }}>{lowStockCount}</div>
          <div className="text-xs text-gray-500 mt-1">Low Stock Alerts</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 text-center py-4">
          <div className="text-3xl font-bold text-black">{items.filter((i) => i.quantity === 0).length}</div>
          <div className="text-xs text-gray-500 mt-1">Out of Stock</div>
        </div>
      </div>

      {/* ─── Add Item Form ────────────────────────────────────── */}
      <section className="bg-white rounded-2xl border border-gray-100 p-5 mb-8">
        <h2 className="flex items-center gap-2 text-base font-bold text-black mb-4">
          <FiPlus className="w-4 h-4" /> Add Equipment
        </h2>
        <form onSubmit={handleAdd} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Item Name *</label>
            <input
              placeholder="e.g. ECG Monitor"
              value={form.item_name}
              onChange={(e) => setForm((p) => ({ ...p, item_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Quantity *</label>
            <input
              type="number" min="0" placeholder="0"
              value={form.quantity}
              onChange={(e) => setForm((p) => ({ ...p, quantity: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
            <input
              placeholder="e.g. units, sets"
              value={form.unit}
              onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Reorder Level</label>
            <input
              type="number" min="0" placeholder="10"
              value={form.reorder_level}
              onChange={(e) => setForm((p) => ({ ...p, reorder_level: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
            <select
              value={form.condition}
              onChange={(e) => setForm((p) => ({ ...p, condition: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
            >
              {CONDITION_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <button
              type="submit"
              disabled={adding}
              className="w-full inline-flex items-center justify-center gap-2 text-white px-4 py-2 rounded-full text-sm font-semibold transition disabled:opacity-60"
              style={{ backgroundColor: '#F97316' }}
            >
              <FiPlus className="w-4 h-4" />
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </form>
      </section>

      {/* ─── Inventory Card Grid ──────────────────────────────── */}
      <section>
        <h2 className="text-base font-bold text-black mb-4 flex items-center gap-2">
          <FiPackage className="w-4 h-4" /> All Equipment
        </h2>
        {inventory.loading ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400">Loading inventory…</div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-2">📦</div>
            <p className="text-gray-500 font-medium">No equipment in inventory yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <EquipmentCard
                key={item.inventory_id}
                item={item}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onImageUpload={handleImageUpload}
                onAddStock={(it) => openStockModal(it, 'in')}
                onRemoveStock={(it) => openStockModal(it, 'out')}
                onHistory={fetchHistory}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Edit Modal ───────────────────────────────────────── */}
      <Modal isOpen={Boolean(editItem)} onClose={() => setEditItem(null)} title="Edit Equipment">
        {editItem && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Item Name</label>
              <input
                value={editItem.item_name}
                onChange={(e) => setEditItem((p) => ({ ...p, item_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  value={editItem.category}
                  onChange={(e) => setEditItem((p) => ({ ...p, category: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                >
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
                <input
                  value={editItem.unit || ''}
                  onChange={(e) => setEditItem((p) => ({ ...p, unit: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reorder Level</label>
                <input
                  type="number" min="0"
                  value={editItem.reorder_level}
                  onChange={(e) => setEditItem((p) => ({ ...p, reorder_level: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Condition</label>
                <select
                  value={editItem.condition || 'good'}
                  onChange={(e) => setEditItem((p) => ({ ...p, condition: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                >
                  {CONDITION_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving}
                className="flex-1 py-3 rounded-full font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: '#F97316' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                onClick={() => setEditItem(null)}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── Stock Movement Modal ─────────────────────────────── */}
      {showStockModal && selectedEquipment && (
        <div
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'white', borderRadius: '20px', padding: '28px',
              width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ fontWeight: '800', fontSize: '18px', margin: 0, color: stockModalType === 'in' ? '#16A34A' : '#EF4444' }}>
                  {stockModalType === 'in' ? '+ Add Stock' : '− Remove Stock'}
                </h3>
                <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '4px 0 0' }}>{selectedEquipment.item_name}</p>
              </div>
              <button
                onClick={() => setShowStockModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#666' }}
              >
                ✕
              </button>
            </div>

            {/* Current stock info */}
            <div style={{ backgroundColor: '#F9FAFB', borderRadius: '12px', padding: '12px 16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 2px' }}>Current Stock</p>
                <p style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: '#000' }}>{selectedEquipment.quantity} units</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '12px', color: '#9CA3AF', margin: '0 0 2px' }}>After Movement</p>
                <p style={{ fontSize: '20px', fontWeight: '800', margin: 0, color: stockModalType === 'in' ? '#16A34A' : '#EF4444' }}>
                  {previewQty} units
                </p>
              </div>
            </div>

            {/* Quantity input */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>Quantity *</label>
              <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #E5E5E5', borderRadius: '12px', overflow: 'hidden' }}>
                <button
                  onClick={() => setStockForm((prev) => ({ ...prev, quantity: Math.max(1, (parseInt(prev.quantity, 10) || 1) - 1) }))}
                  style={{ width: '48px', height: '48px', border: 'none', backgroundColor: '#F9FAFB', fontSize: '20px', cursor: 'pointer', fontWeight: '700' }}
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={stockForm.quantity}
                  onChange={(e) => setStockForm((prev) => ({ ...prev, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                  style={{ flex: 1, textAlign: 'center', border: 'none', fontSize: '20px', fontWeight: '700', outline: 'none', padding: '10px' }}
                />
                <button
                  onClick={() => setStockForm((prev) => ({ ...prev, quantity: (parseInt(prev.quantity, 10) || 1) + 1 }))}
                  style={{ width: '48px', height: '48px', border: 'none', backgroundColor: '#F9FAFB', fontSize: '20px', cursor: 'pointer', fontWeight: '700' }}
                >
                  +
                </button>
              </div>
            </div>

            {/* Reason selection */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#333' }}>Reason *</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {(stockModalType === 'in' ? IN_REASONS : OUT_REASONS).map((r) => {
                  const active = stockForm.reason === r.value;
                  const activeColor = stockModalType === 'in' ? '#16A34A' : '#EF4444';
                  const activeBg = stockModalType === 'in' ? '#F0FDF4' : '#FEF2F2';
                  return (
                    <button
                      key={r.value}
                      onClick={() => setStockForm((prev) => ({ ...prev, reason: r.value }))}
                      style={{
                        padding: '8px 14px', borderRadius: '999px',
                        border: `1.5px solid ${active ? activeColor : '#E5E5E5'}`,
                        backgroundColor: active ? activeBg : 'white',
                        color: active ? activeColor : '#666',
                        fontSize: '12px', fontWeight: '500', cursor: 'pointer',
                      }}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Vendor fields (purchase only) */}
            {stockModalType === 'in' && stockForm.reason === 'purchase' && (
              <div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>Vendor/Supplier Name</label>
                  <input
                    value={stockForm.vendor_name}
                    onChange={(e) => setStockForm((prev) => ({ ...prev, vendor_name: e.target.value }))}
                    placeholder="e.g. Medical Supplies Co."
                    style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E5E5E5', borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>Invoice Number</label>
                  <input
                    value={stockForm.invoice_number}
                    onChange={(e) => setStockForm((prev) => ({ ...prev, invoice_number: e.target.value }))}
                    placeholder="e.g. INV-2026-001"
                    style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E5E5E5', borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            )}

            {/* Date */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>Date</label>
              <input
                type="date"
                value={stockForm.movement_date}
                onChange={(e) => setStockForm((prev) => ({ ...prev, movement_date: e.target.value }))}
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #E5E5E5', borderRadius: '10px', fontSize: '14px', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#333' }}>
                Notes
                <span style={{ color: '#9CA3AF', fontWeight: '400', marginLeft: '4px' }}>(optional)</span>
              </label>
              <textarea
                value={stockForm.notes}
                onChange={(e) => setStockForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Any additional notes..."
                rows={2}
                style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E5E5E5', borderRadius: '10px', fontSize: '14px', resize: 'none', outline: 'none', boxSizing: 'border-box' }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleStockMovement}
              disabled={!stockForm.reason || stockSaving}
              style={{
                width: '100%', padding: '14px',
                backgroundColor: !stockForm.reason ? '#E5E5E5' : stockModalType === 'in' ? '#16A34A' : '#EF4444',
                color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', fontSize: '16px',
                cursor: stockForm.reason && !stockSaving ? 'pointer' : 'not-allowed',
              }}
            >
              {stockSaving
                ? 'Saving…'
                : stockModalType === 'in'
                  ? `+ Add ${stockForm.quantity} to Stock`
                  : `− Remove ${stockForm.quantity} from Stock`}
            </button>
          </div>
        </div>
      )}

      {/* ─── Movement History Modal ───────────────────────────── */}
      {showHistoryModal && (
        <div
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: 'white', borderRadius: '20px', padding: '28px',
              width: '100%', maxWidth: '560px', maxHeight: '85vh', display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexShrink: 0 }}>
              <div>
                <h3 style={{ fontWeight: '700', fontSize: '18px', margin: 0 }}>📋 Movement History</h3>
                <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '4px 0 0' }}>{selectedEquipment?.item_name}</p>
              </div>
              <button
                onClick={() => setShowHistoryModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {stockHistory.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <p style={{ fontSize: '32px' }}>📋</p>
                  <p style={{ color: '#9CA3AF' }}>No movement history yet</p>
                </div>
              ) : (
                stockHistory.map((mov, i) => (
                  <div
                    key={mov.movement_id || i}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 0',
                      borderBottom: i < stockHistory.length - 1 ? '1px solid #F5F5F5' : 'none',
                    }}
                  >
                    <div
                      style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        backgroundColor: mov.movement_type === 'in' ? '#F0FDF4' : '#FEF2F2',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', flexShrink: 0,
                      }}
                    >
                      {mov.movement_type === 'in' ? '↑' : '↓'}
                    </div>

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <p style={{ fontWeight: '600', fontSize: '14px', margin: '0 0 2px', color: mov.movement_type === 'in' ? '#16A34A' : '#EF4444' }}>
                            {mov.movement_type === 'in' ? '+' : '-'}{mov.quantity} units
                          </p>
                          <p style={{ fontSize: '12px', color: '#666', margin: '0 0 2px' }}>{mov.reason_display}</p>
                          {mov.vendor_name && (
                            <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>Vendor: {mov.vendor_name}</p>
                          )}
                          {mov.invoice_number && (
                            <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>Invoice: {mov.invoice_number}</p>
                          )}
                          {mov.notes && (
                            <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '2px 0 0', fontStyle: 'italic' }}>{mov.notes}</p>
                          )}
                        </div>

                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '0 0 2px' }}>
                            {mov.stock_before}
                            {' → '}
                            <span style={{ fontWeight: '700', color: '#000' }}>{mov.stock_after}</span>
                          </p>
                          <p style={{ fontSize: '11px', color: '#9CA3AF', margin: 0 }}>{mov.created_at}</p>
                          {mov.performed_by && mov.performed_by !== 'System' && (
                            <p style={{ fontSize: '10px', color: '#C4C4C4', margin: '2px 0 0' }}>{mov.performed_by}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default InventoryPage;
