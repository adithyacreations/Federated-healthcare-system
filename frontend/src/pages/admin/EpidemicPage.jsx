import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiAlertTriangle, FiPlus, FiBell, FiRefreshCw, FiSearch, FiCpu, FiCheckCircle, FiX } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const ALERT_LEVELS = ['low', 'moderate', 'high', 'critical'];

const LEVEL_STYLES = {
  low:      { card: 'border-blue-200   bg-blue-50',   badge: 'bg-blue-100   text-blue-800'   },
  moderate: { card: 'border-yellow-200 bg-yellow-50', badge: 'bg-yellow-100 text-yellow-800' },
  high:     { card: 'border-orange-200 bg-orange-50', badge: 'bg-orange-100 text-orange-800' },
  critical: { card: 'border-red-200    bg-red-50',    badge: 'bg-red-100    text-red-800'    },
};

const AlertBadge = ({ level }) => {
  const s = LEVEL_STYLES[level] || LEVEL_STYLES.low;
  return (
    <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.badge}`}>
      {level}
    </span>
  );
};

const EpidemicPage = () => {
  const epidemic = useApi('/api/federated/epidemic/');
  const [broadcasting, setBroadcasting] = useState(false);
  const [addingTrend, setAddingTrend] = useState(false);
  const [autoAlerts, setAutoAlerts] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [creatingAlerts, setCreatingAlerts] = useState(false);
  const [newTrend, setNewTrend] = useState({
    disease_name: '', region: '', case_count: '',
    alert_level: 'low', spike_detected: false,
    recorded_date: new Date().toISOString().slice(0, 10),
  });
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [selectedEpidemic, setSelectedEpidemic] = useState(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [resolving, setResolving] = useState(false);

  const allTrends = epidemic.data?.trends || [];
  const activeEpidemics = epidemic.data?.active
    || allTrends.filter((t) => !t.is_resolved);
  const spikes = activeEpidemics.filter((t) => t.spike_detected);

  const openResolveModal = (ep) => {
    setSelectedEpidemic(ep);
    setResolutionNote('');
    setShowResolveModal(true);
  };

  const closeResolveModal = () => {
    setShowResolveModal(false);
    setSelectedEpidemic(null);
    setResolutionNote('');
  };

  const handleResolve = async () => {
    if (!selectedEpidemic) return;
    setResolving(true);
    try {
      const res = await API.post(
        `/api/federated/epidemic/${selectedEpidemic.trend_id}/resolve/`,
        { resolution_note: resolutionNote || 'Epidemic resolved by admin' },
      );
      toast.success(res.data?.message || 'Epidemic resolved.');
      closeResolveModal();
      epidemic.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to resolve epidemic');
    } finally {
      setResolving(false);
    }
  };

  const handleAddTrend = async (e) => {
    e.preventDefault();
    if (!newTrend.disease_name.trim() || !newTrend.case_count) {
      toast.error('Disease name and case count are required');
      return;
    }
    setAddingTrend(true);
    try {
      await API.post('/api/federated/epidemic/create/', {
        ...newTrend,
        case_count: parseInt(newTrend.case_count, 10),
      });
      toast.success(
        newTrend.spike_detected
          ? 'Alert added! Notifications sent to all hospital admins.'
          : 'Epidemic trend recorded.'
      );
      epidemic.refetch();
      setNewTrend({
        disease_name: '', region: '', case_count: '',
        alert_level: 'low', spike_detected: false,
        recorded_date: new Date().toISOString().slice(0, 10),
      });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add trend');
    } finally {
      setAddingTrend(false);
    }
  };

  const handleBroadcast = async (trend = null) => {
    setBroadcasting(true);
    try {
      const payload = trend
        ? {
            disease_name: trend.disease_name,
            alert_level: trend.alert_level,
            region: trend.region || 'Kerala',
            message: `⚠️ ${trend.disease_name} epidemic alert in ${trend.region || 'Kerala'}. `
              + `${trend.case_count ?? trend.current_week_cases ?? 0} cases detected. `
              + `Alert level: ${(trend.alert_level || 'high').toUpperCase()}.`,
          }
        : { disease_name: 'General Health Advisory', alert_level: 'high', region: 'Kerala' };
      const res = await API.post('/api/federated/epidemic/broadcast/', payload);
      if (res.data?.success) {
        toast.success(res.data.message || 'Alert sent to all staff!');
      } else {
        toast.error(res.data?.message || 'Broadcast failed');
      }
    } catch (err) {
      console.error('Broadcast error:', err);
      toast.error(err?.response?.data?.message || 'Failed to send alert!');
    } finally {
      setBroadcasting(false);
    }
  };

  const runAutoDetection = async () => {
    setDetecting(true);
    try {
      const res = await API.get('/api/federated/epidemic/auto-detect/');
      if (res.data?.success) {
        setAutoAlerts(res.data.data.auto_alerts || []);
        toast.success(`Found ${res.data.data.spike_count} potential spike(s) in the last 7 days!`);
      }
    } catch (err) {
      toast.error('Detection failed!');
    } finally {
      setDetecting(false);
    }
  };

  const createFromAutoDetection = async () => {
    setCreatingAlerts(true);
    try {
      const res = await API.post('/api/federated/epidemic/auto-detect/');
      if (res.data?.success) {
        toast.success(res.data.message);
        epidemic.refetch();
      }
    } catch (err) {
      toast.error('Failed to create alerts!');
    } finally {
      setCreatingAlerts(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            Epidemic Alerts <span style={{ color: '#F97316' }}>·</span> Monitor
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Track disease spikes, manage alerts, broadcast to all staff</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={epidemic.refetch}
            className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
          >
            <FiRefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={() => handleBroadcast()}
            disabled={broadcasting}
            className="inline-flex items-center gap-2 bg-danger text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-red-600 transition disabled:opacity-60"
          >
            <FiBell className={`w-4 h-4 ${broadcasting ? 'animate-pulse' : ''}`} />
            {broadcasting ? 'Sending…' : 'Send Alert to All Staff'}
          </button>
        </div>
      </div>

      {/* ─── Section 0: Auto Epidemic Detection ─────────────── */}
      <section className="mb-8">
        <div className="card">
          <div className="flex items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-bold text-primary-500 flex items-center gap-2">
                <FiCpu className="w-5 h-5 text-purple-600" /> Auto Epidemic Detection
              </h2>
              <p className="text-sm text-gray-500">
                Analyzes hospital patient data to detect disease spikes automatically (last 7 days)
              </p>
            </div>
            <button
              onClick={runAutoDetection}
              disabled={detecting}
              className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-orange-600 transition disabled:opacity-60 shrink-0"
            >
              <FiSearch className={`w-4 h-4 ${detecting ? 'animate-pulse' : ''}`} />
              {detecting ? 'Detecting…' : 'Run Detection'}
            </button>
          </div>

          {autoAlerts.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              Click "Run Detection" to analyze hospital patient data for disease spikes.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                      <th className="px-4 py-2.5">Disease</th>
                      <th className="px-4 py-2.5">This Week</th>
                      <th className="px-4 py-2.5">Last Week</th>
                      <th className="px-4 py-2.5">Spike %</th>
                      <th className="px-4 py-2.5">Alert Level</th>
                      <th className="px-4 py-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {autoAlerts.map((a) => (
                      <tr key={a.disease_name} className={a.is_spike ? 'bg-red-50/40' : ''}>
                        <td className="px-4 py-2.5 font-semibold text-gray-800">{a.disease_name}</td>
                        <td className="px-4 py-2.5 font-bold text-gray-700">{a.current_week_cases}</td>
                        <td className="px-4 py-2.5 text-gray-500">{a.last_week_cases}</td>
                        <td className={`px-4 py-2.5 font-bold ${a.is_spike ? 'text-danger' : 'text-gray-400'}`}>
                          {a.spike_percentage > 0 ? `+${a.spike_percentage}%` : '—'}
                        </td>
                        <td className="px-4 py-2.5"><AlertBadge level={a.alert_level} /></td>
                        <td className="px-4 py-2.5">
                          {a.is_spike ? (
                            <button
                              onClick={() => handleBroadcast(a)}
                              disabled={broadcasting}
                              className="text-xs font-semibold bg-danger text-white px-3 py-1 rounded-lg hover:bg-red-600 transition disabled:opacity-60"
                            >
                              Send Alert
                            </button>
                          ) : (
                            <span className="text-xs text-gray-400">No spike</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-4 gap-3 flex-wrap">
                <p className="text-sm text-gray-600">
                  Found <strong className="text-danger">{autoAlerts.filter((a) => a.is_spike).length}</strong>{' '}
                  disease spike(s) in the last 7 days.
                </p>
                <button
                  onClick={createFromAutoDetection}
                  disabled={creatingAlerts || autoAlerts.every((a) => !a.is_spike)}
                  className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60"
                >
                  <FiPlus className="w-4 h-4" />
                  {creatingAlerts ? 'Creating…' : 'Create All Alerts'}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* ─── Section 1: Active Spike Alerts ─────────────────── */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-primary-500 mb-4">
          <FiAlertTriangle className="w-5 h-5 text-danger" />
          Active Spike Alerts
          {spikes.length > 0 && (
            <span className="ml-1 text-xs bg-danger text-white px-2 py-0.5 rounded-full font-bold">
              {spikes.length}
            </span>
          )}
        </h2>
        {epidemic.loading ? (
          <div className="card text-center text-gray-400 text-sm py-6">Loading…</div>
        ) : spikes.length === 0 ? (
          <div className="card text-center py-8">
            <div className="text-4xl mb-2">🌿</div>
            <div className="text-gray-500 font-medium">No active epidemic spikes.</div>
            <div className="text-gray-400 text-sm mt-1">All regions are clear.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {spikes.map((t) => {
              const s = LEVEL_STYLES[t.alert_level] || LEVEL_STYLES.low;
              return (
                <div key={t.trend_id} className={`rounded-2xl border-2 p-5 ${s.card}`}>
                  <div className="flex items-start justify-between mb-3">
                    <h4 className="font-bold text-xl text-gray-800">{t.disease_name}</h4>
                    <AlertBadge level={t.alert_level} />
                  </div>
                  <div className="space-y-1.5 text-sm text-gray-700">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Region</span>
                      <span className="font-medium">{t.region || '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Cases</span>
                      <span className="font-bold text-danger">{t.case_count.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Recorded</span>
                      <span>{t.recorded_date}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-xs font-semibold text-danger">
                      🚨 Spike Detected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleBroadcast(t)}
                        disabled={broadcasting}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold bg-danger text-white px-3 py-1.5 rounded-lg hover:bg-red-600 transition disabled:opacity-60"
                      >
                        <FiBell className="w-3.5 h-3.5" /> Send Alert
                      </button>
                      <button
                        onClick={() => openResolveModal(t)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 transition"
                      >
                        <FiCheckCircle className="w-3.5 h-3.5" /> Resolve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── Section 2: Add New Alert ───────────────────────── */}
      <section className="mb-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-primary-500 mb-4">
          <FiPlus className="w-5 h-5" /> Add Epidemic Alert
        </h2>
        <div className="card">
          <form onSubmit={handleAddTrend} className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Disease Name *</label>
              <input
                placeholder="e.g. Dengue Fever"
                value={newTrend.disease_name}
                onChange={(e) => setNewTrend((p) => ({ ...p, disease_name: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Region</label>
              <input
                placeholder="e.g. Kollam"
                value={newTrend.region}
                onChange={(e) => setNewTrend((p) => ({ ...p, region: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Case Count *</label>
              <input
                type="number"
                min="0"
                placeholder="e.g. 120"
                value={newTrend.case_count}
                onChange={(e) => setNewTrend((p) => ({ ...p, case_count: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Alert Level</label>
              <select
                value={newTrend.alert_level}
                onChange={(e) => setNewTrend((p) => ({ ...p, alert_level: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              >
                {ALERT_LEVELS.map((l) => <option key={l} value={l} className="capitalize">{l}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date Recorded</label>
              <input
                type="date"
                value={newTrend.recorded_date}
                onChange={(e) => setNewTrend((p) => ({ ...p, recorded_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <div
                  onClick={() => setNewTrend((p) => ({ ...p, spike_detected: !p.spike_detected }))}
                  className={`w-11 h-6 rounded-full transition-colors ${newTrend.spike_detected ? 'bg-danger' : 'bg-gray-200'} relative cursor-pointer`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${newTrend.spike_detected ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className={`text-sm font-medium ${newTrend.spike_detected ? 'text-danger' : 'text-gray-500'}`}>
                  {newTrend.spike_detected ? '🚨 Spike Detected' : 'No Spike'}
                </span>
              </label>
            </div>
            <div className="col-span-2 sm:col-span-3 flex justify-end">
              <button
                type="submit"
                disabled={addingTrend}
                className="inline-flex items-center gap-2 bg-orange-500 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-60"
              >
                <FiPlus className="w-4 h-4" />
                {addingTrend ? 'Adding…' : 'Add Epidemic Alert'}
              </button>
            </div>
          </form>
        </div>
      </section>

      {/* Resolved history & full trend table now live on dedicated sidebar
          pages: "Resolved Alerts" and "Epidemic History". */}

      {/* ─── Resolve Modal ────────────────────────────────────── */}
      {showResolveModal && selectedEpidemic && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closeResolveModal}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-primary-500 flex items-center gap-2">
                <FiCheckCircle className="w-5 h-5 text-green-600" /> Resolve Epidemic Alert
              </h3>
              <button
                onClick={closeResolveModal}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <FiX />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-700">
                Resolving: <span className="font-semibold">{selectedEpidemic.disease_name}</span>
                {selectedEpidemic.region ? <> in <span className="font-semibold">{selectedEpidemic.region}</span></> : null}
              </p>

              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                <p className="text-yellow-800 text-sm font-semibold mb-1">⚠️ This will:</p>
                <ul className="text-yellow-700 text-xs space-y-0.5">
                  <li>• Remove alert from active list</li>
                  <li>• Notify all hospital staff</li>
                  <li>• Mark epidemic as resolved</li>
                </ul>
              </div>

              <textarea
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Resolution note (optional) — e.g. Situation under control, cases decreased…"
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-300"
              />

              <div className="flex gap-3">
                <button
                  onClick={handleResolve}
                  disabled={resolving}
                  className="flex-1 bg-orange-500 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {resolving ? 'Resolving…' : 'Confirm Resolve'}
                </button>
                <button
                  onClick={closeResolveModal}
                  className="flex-1 bg-gray-100 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default EpidemicPage;
