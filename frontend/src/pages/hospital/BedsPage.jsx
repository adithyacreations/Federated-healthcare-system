import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiGrid, FiPlus, FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const STATUS_STYLE = {
  available: 'border-success/40 bg-success/10 text-success',
  occupied:  'border-red-300   bg-red-50   text-danger',
  reserved:  'border-yellow-300 bg-yellow-50 text-warning',
};

const TYPE_BADGE = {
  general:    'bg-blue-100  text-blue-700',
  icu:        'bg-red-100   text-red-700',
  ventilator: 'bg-purple-100 text-purple-700',
};

const BLANK_FORM = { bed_type: 'general', ward_name: '' };

const BedsPage = () => {
  const beds = useApi('/api/hospital/beds/');
  const [form, setForm] = useState(BLANK_FORM);
  const [adding, setAdding] = useState(false);

  const summary = beds.data?.summary || {};
  const bedList = beds.data?.beds || [];

  const handleAdd = async (e) => {
    e.preventDefault();
    setAdding(true);
    try {
      await API.post('/api/hospital/beds/add/', form);
      toast.success('Bed added successfully');
      beds.refetch();
      setForm(BLANK_FORM);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add bed');
    } finally {
      setAdding(false);
    }
  };

  const cycleStatus = async (bed) => {
    if (bed.reserved_for_emergency) {
      toast.error('🔒 This bed is reserved for an active emergency and cannot be changed.');
      return;
    }
    const next = { available: 'occupied', occupied: 'reserved', reserved: 'available' }[bed.status];
    try {
      await API.put(`/api/hospital/beds/${bed.bed_id}/`, { status: next });
      toast.success(`Bed → ${next}`);
      beds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Update failed');
    }
  };

  // Days that have elapsed since the bed was emergency-locked.
  const daysElapsed = (bed) => {
    if (!bed.emergency_locked_at) return null;
    const ms = Date.now() - new Date(bed.emergency_locked_at).getTime();
    return Math.floor(ms / 86400000);
  };

  // Whole days the admin must still wait before a force-unlock is allowed.
  const daysRemaining = (bed) => {
    const elapsed = daysElapsed(bed);
    if (elapsed === null) return bed.minimum_lock_days ?? 3;
    return Math.max(0, (bed.minimum_lock_days ?? 3) - elapsed);
  };

  const canUnlock = (bed) => daysRemaining(bed) <= 0;

  const handleUnlock = async (bed) => {
    try {
      await API.post(`/api/hospital/beds/${bed.bed_id}/unlock/`);
      toast.success('🔓 Bed unlocked and freed.');
      beds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Unlock failed');
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Bed Management</h1>
          <p className="text-sm text-gray-500">Track and manage all hospital beds</p>
        </div>
        <button
          onClick={beds.refetch}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ─── Stats ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-8">
        {[
          { label: 'Total Beds',     value: summary.total ?? '—',      color: 'text-primary-500' },
          { label: 'Available',      value: summary.available ?? '—',   color: 'text-success' },
          { label: 'Occupied',       value: summary.occupied ?? '—',    color: 'text-danger' },
          { label: 'Reserved',       value: summary.reserved ?? '—',    color: 'text-warning' },
          { label: 'ICU Available',  value: beds.data?.icu_available ?? (bedList.filter(b => b.bed_type === 'icu' && b.status === 'available').length) ?? '—', color: 'text-purple-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center py-4">
            <div className={`text-3xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500 mt-1">{label}</div>
          </div>
        ))}
      </div>

      {/* ─── Add Bed Form ─────────────────────────────────────── */}
      <section className="card mb-8">
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-700 mb-4">
          <FiPlus className="w-4 h-4" /> Add New Bed
        </h2>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bed Type</label>
            <select
              value={form.bed_type}
              onChange={(e) => setForm((p) => ({ ...p, bed_type: e.target.value }))}
              className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              <option value="general">General</option>
              <option value="icu">ICU</option>
              <option value="ventilator">Ventilator</option>
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-gray-600 mb-1">Ward Name</label>
            <input
              placeholder="e.g. Ward A"
              value={form.ward_name}
              onChange={(e) => setForm((p) => ({ ...p, ward_name: e.target.value }))}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60"
          >
            <FiPlus className="w-4 h-4" />
            {adding ? 'Adding…' : 'Add Bed'}
          </button>
        </form>
      </section>

      {/* ─── All Beds Grid ────────────────────────────────────── */}
      <section>
        <h2 className="flex items-center gap-2 text-base font-bold text-gray-700 mb-4">
          <FiGrid className="w-4 h-4" />
          All Beds
          <span className="text-xs font-normal text-gray-400 ml-1">Click a bed card to cycle its status</span>
        </h2>
        <div className="card">
          {beds.loading ? (
            <p className="text-gray-400 text-sm text-center py-6">Loading beds…</p>
          ) : bedList.length === 0 ? (
            <div className="text-center py-10">
              <div className="text-4xl mb-2">🛏️</div>
              <p className="text-gray-500 font-medium">No beds added yet.</p>
              <p className="text-gray-400 text-sm mt-1">Use the form above to add beds.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {bedList.map((b) => (
                b.reserved_for_emergency ? (
                  <div
                    key={b.bed_id}
                    className="p-3 rounded-xl border-2 text-left bg-red-50"
                    style={{ borderColor: '#FCA5A5' }}
                    title="Reserved for an active emergency — locked"
                  >
                    <div className="flex items-start justify-between">
                      <div className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-block mb-1 ${TYPE_BADGE[b.bed_type] || 'bg-gray-100 text-gray-600'}`}>
                        {b.bed_type}
                      </div>
                      <span className="text-lg leading-none">🔒</span>
                    </div>
                    <div className="font-semibold text-sm truncate text-red-700">{b.ward_name || '—'}</div>
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full mt-1 inline-block">
                      🚨 Emergency
                    </span>
                    {canUnlock(b) ? (
                      <button
                        onClick={() => handleUnlock(b)}
                        className="mt-2 w-full text-[11px] font-semibold bg-orange-500 text-white px-2 py-1 rounded-lg hover:bg-orange-600 transition"
                      >
                        🔓 Unlock Bed
                      </button>
                    ) : (
                      <p className="mt-2 text-[10px] text-gray-500 leading-tight">
                        Locked · {daysRemaining(b)} day{daysRemaining(b) === 1 ? '' : 's'} left to unlock
                      </p>
                    )}
                  </div>
                ) : (
                  <button
                    key={b.bed_id}
                    onClick={() => cycleStatus(b)}
                    className={`p-3 rounded-xl border-2 text-left hover:scale-[1.03] transition-all ${STATUS_STYLE[b.status] || STATUS_STYLE.available}`}
                    title="Click to cycle: available → occupied → reserved → available"
                  >
                    <div className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-block mb-1 ${TYPE_BADGE[b.bed_type] || 'bg-gray-100 text-gray-600'}`}>
                      {b.bed_type}
                    </div>
                    <div className="font-semibold text-sm truncate">{b.ward_name || '—'}</div>
                    <div className="text-xs mt-1 capitalize font-medium">{b.status}</div>
                  </button>
                )
              ))}
            </div>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
};

export default BedsPage;
