import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import {
  FiCpu, FiPlay, FiZap, FiRefreshCw, FiX, FiCheck, FiTrash2, FiUsers,
  FiBell, FiAlertTriangle, FiClock,
} from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

const fmtDeadline = (iso) => {
  if (!iso) return null;
  const deadline = new Date(iso);
  const now = new Date();
  const diffMs = deadline - now;
  if (diffMs <= 0) return { text: 'Deadline passed', urgent: true };
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  const urgent = diffMs < 6 * 3600 * 1000;
  let text = '';
  if (days > 0) text = `${days}d ${hours}h remaining`;
  else if (hours > 0) text = `${hours}h ${mins}m remaining`;
  else text = `${mins}m remaining`;
  return { text, urgent };
};

// ─── Initialize Model Modal ───────────────────────────────────────────────────

const InitModal = ({ onClose, onSuccess }) => {
  const [modelType, setModelType] = useState('symptom_checker');
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!version.trim()) { toast.error('Version is required'); return; }
    setLoading(true);
    try {
      await API.post('/api/federated/initialize/', { model_type: modelType, version: version.trim() });
      toast.success(`Model v${version} initialized! Now click Start FL Round.`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Initialization failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-primary-500">Initialize New FL Model</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><FiX /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model Type</label>
            <select
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            >
              <option value="symptom_checker">Symptom Checker (Logistic Regression)</option>
              <option value="clinical_diagnosis">Clinical Diagnosis (Random Forest)</option>
              <option value="risk_predictor">Risk Predictor (Random Forest)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Version label (e.g. v2.0)</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v2.0"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-500 text-white py-2 rounded-xl font-semibold hover:bg-orange-600 transition disabled:opacity-60"
          >
            {loading ? 'Initializing… (training on real dataset)' : 'Initialize Model'}
          </button>
        </form>
      </div>
    </div>
  );
};

// ─── Extend Deadline Modal ────────────────────────────────────────────────────

const ExtendModal = ({ onClose, onExtend }) => {
  const [hours, setHours] = useState(24);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    await onExtend(hours);
    setLoading(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-primary-500 flex items-center gap-2">
            <FiClock className="w-4 h-4" /> Extend Deadline
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg"><FiX /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600">Extend the round deadline by how many hours?</p>
          <div className="grid grid-cols-3 gap-2">
            {[12, 24, 48].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={`py-2.5 rounded-xl text-sm font-semibold border-2 transition ${
                  hours === h
                    ? 'border-primary-500 bg-primary-50 text-primary-600'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {h} hours
              </button>
            ))}
          </div>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-orange-500 text-white py-2 rounded-xl font-semibold hover:bg-orange-600 transition disabled:opacity-60"
          >
            {loading ? 'Extending…' : `Extend by ${hours} hours`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const FLMonitor = () => {
  const [showInit, setShowInit] = useState(false);
  const [showExtend, setShowExtend] = useState(false);
  const [simulatingAll, setSimulatingAll] = useState(false);
  const [simulateResults, setSimulateResults] = useState(null);
  const [weightsData, setWeightsData] = useState(null);
  const [loadingWeights, setLoadingWeights] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [forcingAggregate, setForcingAggregate] = useState(false);
  const [readyToAggregate, setReadyToAggregate] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [cancellingRound, setCancellingRound] = useState(false);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [newThreshold, setNewThreshold] = useState('');
  const [updatingThreshold, setUpdatingThreshold] = useState(false);

  const dashboard = useApi('/api/federated/dashboard/');
  const rounds    = useApi('/api/federated/rounds/');

  // Stable refetch refs for the WS handler
  const refetchersRef = useRef({});
  refetchersRef.current = {
    dashboard: dashboard.refetch,
    rounds:    rounds.refetch,
  };

  // ─── Real-time FL updates via WebSocket ─────────────────────────────────
  useEffect(() => {
    const wsHost = window.location.hostname || 'localhost';
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${wsHost}:8000/ws/fl/global/`);

    ws.onopen = () => console.log('[FLMonitor] WebSocket connected');

    ws.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      const { type, data = {} } = payload;
      const r = refetchersRef.current;

      if (type === 'weight_submitted') {
        toast.success(
          `${data.hospital_name} submitted weights! ${data.completed}/${data.invited} hospitals done.`,
        );
        r.rounds?.();
        r.dashboard?.();
        if (data.completed >= data.invited && data.invited > 0) {
          setReadyToAggregate(true);
        }
      }

      if (type === 'round_started') {
        toast.success(`Round ${data.round_number} started!`);
        setReadyToAggregate(false);
        r.rounds?.();
        r.dashboard?.();
      }

      if (type === 'model_updated') {
        toast.success(`FedAvg done — new accuracy: ${data.new_accuracy}%`);
        setReadyToAggregate(false);
        r.rounds?.();
        r.dashboard?.();
      }
    };

    ws.onerror = (e) => console.warn('[FLMonitor] WebSocket error', e);

    return () => { try { ws.close(); } catch { /* noop */ } };
  }, []);

  const data        = dashboard.data || {};
  const activeModel = data.active_model;
  const accuracyTrend = (data.accuracy_trend || []).map((r) => ({
    round: `R${r.round}`,
    accuracy: r.accuracy,
  }));

  const roundsList = rounds.data?.rounds || [];
  const activeRound = roundsList.find(
    (r) => r.status === 'training' || r.status === 'aggregating',
  ) || roundsList.find((r) => r.status === 'pending');

  // Auto-load round details (pending hospitals) when active round changes
  const fetchWeights = useCallback(async (roundId) => {
    if (!roundId) return;
    setLoadingWeights(true);
    try {
      const res = await API.get(`/api/federated/rounds/${roundId}/`);
      setWeightsData(res.data?.data);
    } catch {
      toast.error('Could not load hospital weights');
    } finally {
      setLoadingWeights(false);
    }
  }, []);

  useEffect(() => {
    if (activeRound?.round_id) {
      fetchWeights(activeRound.round_id);
    } else {
      setWeightsData(null);
    }
  }, [activeRound?.round_id, fetchWeights]);

  // ── handlers ─────────────────────────────────────────────────────────────────

  const handleRefreshAll = () => {
    dashboard.refetch();
    rounds.refetch();
  };

  const handleStartRound = async () => {
    try {
      const res = await API.post('/api/federated/start-round/');
      toast.success(res.data?.message || 'FL Round started!');
      dashboard.refetch();
      rounds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not start round');
    }
  };

  const handleAggregate = async () => {
    const target = activeRound;
    if (!target) { toast.error('No active round to aggregate. Start a round first.'); return; }
    try {
      const res = await API.post('/api/federated/aggregate/', { round_id: target.round_id });
      const newAcc = res.data?.data?.new_accuracy;
      toast.success(`FedAvg complete! New global accuracy: ${newAcc != null ? `${newAcc}%` : 'updated'}`);
      setSimulateResults(null);
      setWeightsData(null);
      dashboard.refetch();
      rounds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Aggregation failed');
    }
  };

  const handleSimulateAll = async () => {
    if (!activeRound) { toast.error('No active training round. Start an FL round first.'); return; }
    setSimulatingAll(true);
    setSimulateResults(null);
    try {
      const res = await API.post('/api/federated/simulate-all/');
      const d = res.data?.data;
      const results = d?.results || [];
      setSimulateResults(results);
      const avgAcc = results.length > 0
        ? (results.reduce((s, r) => s + (r.local_accuracy || 0), 0) / results.length).toFixed(1)
        : null;
      toast.success(
        `${d?.simulated} hospital(s) simulated! Avg accuracy: ${avgAcc}%. Now run FedAvg Aggregation.`,
      );
      dashboard.refetch();
      rounds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Simulation failed');
    } finally {
      setSimulatingAll(false);
    }
  };

  const handleCancelRound = async () => {
    if (!activeRound) return;
    const confirmed = window.confirm(
      `Cancel Round ${activeRound.round_number}? This cannot be undone.`,
    );
    if (!confirmed) return;
    setCancellingRound(true);
    try {
      const res = await API.post('/api/federated/cancel-round/');
      toast.success(res.data?.message || 'Round cancelled.');
      setSimulateResults(null);
      setWeightsData(null);
      setReadyToAggregate(false);
      dashboard.refetch();
      rounds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to cancel round');
    } finally {
      setCancellingRound(false);
    }
  };

  const handleLowerThreshold = async () => {
    const value = parseInt(newThreshold, 10);
    if (!value || value < 1) {
      toast.error('Enter a valid threshold (>= 1)');
      return;
    }
    setUpdatingThreshold(true);
    try {
      const res = await API.post('/api/federated/lower-threshold/', { threshold: value });
      toast.success(res.data?.message || 'Threshold updated.');
      if (res.data?.data?.aggregation_triggered) {
        toast.success('🎉 Threshold met — FedAvg ran automatically!');
      }
      setShowThresholdModal(false);
      setNewThreshold('');
      dashboard.refetch();
      rounds.refetch();
      if (activeRound?.round_id) fetchWeights(activeRound.round_id);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to update threshold');
    } finally {
      setUpdatingThreshold(false);
    }
  };

  const handleReset = async () => {
    const ok = window.confirm(
      '⚠️ WARNING: This will permanently delete ALL FL history including rounds, weights, and global models.\n\nThis CANNOT be undone!',
    );
    if (!ok) return;

    const typed = window.prompt('Type RESET (in capitals) to confirm complete FL data reset:');
    if (typed !== 'RESET') {
      toast.error('Reset cancelled — you must type RESET exactly.');
      return;
    }

    setResetting(true);
    try {
      const response = await API.delete('/api/federated/reset/');
      const d = response.data?.data || {};

      if (response.data?.success) {
        toast.success(
          `✅ FL Reset Complete! Deleted: ${d.deleted_models ?? 0} models, ${d.deleted_rounds ?? 0} rounds, ${d.deleted_weights ?? 0} weights`,
        );

        // Give the backend a moment to fully commit, then wipe all client state
        // and force a remount of the FL Monitor subtree so every chart / table
        // re-mounts with fresh (empty) data.
        setTimeout(() => {
          setSimulateResults(null);
          setWeightsData(null);
          setReadyToAggregate(false);
          dashboard.refetch();
          rounds.refetch();
          setResetKey((prev) => prev + 1);
        }, 500);
      } else {
        toast.error(response.data?.message || 'Reset failed');
      }
    } catch (err) {
      console.error('Reset error:', err);
      toast.error(err?.response?.data?.message || 'Reset failed! Check console.');
    } finally {
      setResetting(false);
    }
  };

  const handleSendReminder = async () => {
    setSendingReminder(true);
    try {
      const res = await API.post('/api/federated/send-reminder/');
      const d = res.data?.data;
      toast.success(res.data?.message || `Reminder sent to ${d?.reminded_count} hospital(s)!`);
      rounds.refetch();
      if (activeRound?.round_id) fetchWeights(activeRound.round_id);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to send reminder');
    } finally {
      setSendingReminder(false);
    }
  };

  const handleForceAggregate = async () => {
    const submittedCount = weightsData?.submissions_count ?? 0;
    const invitedCount = activeRound?.hospitals_invited ?? 0;
    const skipped = invitedCount - submittedCount;
    const confirmed = window.confirm(
      `Force aggregate with ${submittedCount}/${invitedCount} hospitals?\n${skipped > 0 ? `${skipped} hospital(s) will be skipped.` : 'All hospitals have submitted.'}\n\nProceed?`,
    );
    if (!confirmed) return;
    setForcingAggregate(true);
    try {
      const res = await API.post('/api/federated/force-aggregate/');
      const d = res.data?.data;
      toast.success(
        `Force aggregation complete! ${d?.weights_included}/${invitedCount} hospitals included. New accuracy: ${d?.new_accuracy}%`,
      );
      setSimulateResults(null);
      setWeightsData(null);
      dashboard.refetch();
      rounds.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Force aggregation failed');
    } finally {
      setForcingAggregate(false);
    }
  };

  const handleExtendDeadline = async (hours) => {
    try {
      const res = await API.post('/api/federated/extend-deadline/', { extend_hours: hours });
      const d = res.data?.data;
      toast.success(`Deadline extended! New deadline: ${d?.new_deadline_str}`);
      rounds.refetch();
      if (activeRound?.round_id) fetchWeights(activeRound.round_id);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to extend deadline');
    }
  };

  // ── computed values ───────────────────────────────────────────────────────────

  const deadlineInfo = activeRound?.round_deadline ? fmtDeadline(activeRound.round_deadline) : null;
  const completed = activeRound?.hospitals_completed ?? 0;
  const invited = activeRound?.hospitals_invited ?? 0;
  const threshold = activeRound?.min_hospitals_threshold ?? 1;
  const thresholdPct = invited > 0 ? Math.round((completed / invited) * 100) : 0;
  const thresholdMet = completed >= threshold;
  const pendingHospitals = weightsData?.pending_hospitals || [];
  const canForceAggregate = activeRound?.status === 'training' && (weightsData?.submissions_count ?? 0) > 0;

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
    <div key={resetKey}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            FL Monitor <span style={{ color: '#F97316' }}>·</span> Oversight
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Federated Learning · FedAvg aggregation · Real dataset training</p>
        </div>
        <button
          onClick={handleRefreshAll}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Real-time: all hospitals submitted banner */}
      {readyToAggregate && (
        <div className="bg-green-50 border border-green-300 rounded-xl p-4 mb-4 flex items-start justify-between gap-3">
          <p className="text-green-800 font-bold">
            ✅ All hospitals submitted! Run FedAvg Aggregation now.
          </p>
          <button
            onClick={() => setReadyToAggregate(false)}
            className="text-green-700 hover:text-green-900 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Model Version',
            value: activeModel?.version || 'None',
            sub: activeModel?.is_active ? 'Active' : 'No active model',
            icon: '🤖',
          },
          {
            label: 'Global Accuracy',
            value: activeModel?.accuracy != null ? `${activeModel.accuracy}%` : '—',
            sub: 'Latest aggregation',
            icon: '🎯',
          },
          {
            label: 'Total Rounds',
            value: data.total_rounds ?? 0,
            sub: 'All time',
            icon: '🔄',
          },
          {
            label: 'Hospitals',
            value: data.participating_hospitals ?? 0,
            sub: 'Participating',
            icon: '🏥',
          },
        ].map(({ label, value, sub, icon }) => (
          <div key={label} className="card text-center">
            <div className="text-2xl mb-1">{icon}</div>
            <div className="text-2xl font-bold text-primary-500">{value}</div>
            <div className="text-xs font-medium text-gray-600 mt-0.5">{label}</div>
            <div className="text-[11px] text-gray-400">{sub}</div>
          </div>
        ))}
      </div>

      {/* Deadline + Threshold banner (shown only when active round exists) */}
      {activeRound && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          {/* Deadline card */}
          <div className={`rounded-2xl border px-5 py-4 flex items-center gap-4 ${
            deadlineInfo?.urgent
              ? 'bg-red-50 border-red-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <FiClock className={`w-8 h-8 flex-shrink-0 ${deadlineInfo?.urgent ? 'text-red-500' : 'text-amber-500'}`} />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-0.5">
                Round {activeRound.round_number} Deadline
              </div>
              {deadlineInfo ? (
                <div className={`text-base font-bold ${deadlineInfo.urgent ? 'text-red-600' : 'text-amber-700'}`}>
                  {deadlineInfo.text}
                </div>
              ) : (
                <div className="text-sm text-gray-500">No deadline set</div>
              )}
              {activeRound.round_deadline && (
                <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(activeRound.round_deadline)}</div>
              )}
            </div>
            <button
              onClick={() => setShowExtend(true)}
              className="ml-auto flex-shrink-0 text-xs font-semibold text-orange-500 border border-orange-300 px-3 py-1.5 rounded-lg hover:bg-orange-50 transition"
            >
              Extend
            </button>
          </div>

          {/* Threshold card */}
          <div className={`rounded-2xl border px-5 py-4 ${
            thresholdMet ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Submission Progress
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                thresholdMet ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
              }`}>
                {thresholdMet ? 'Threshold Met!' : `Need ${threshold - completed} more`}
              </span>
            </div>
            <div className="flex items-end gap-2 mb-2">
              <span className="text-2xl font-bold text-primary-500">{completed}</span>
              <span className="text-sm text-gray-500 mb-0.5">/ {invited} hospitals</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all ${thresholdMet ? 'bg-green-500' : 'bg-secondary'}`}
                style={{ width: `${thresholdPct}%` }}
              />
            </div>
            <div className="text-[11px] text-gray-400 mt-1">
              Minimum required: {threshold}/{invited} hospitals ({Math.round((threshold / Math.max(invited, 1)) * 100)}%)
            </div>
          </div>
        </div>
      )}

      {/* Control buttons */}
      <div className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">FL Controls</h2>

        <div className="flex flex-wrap gap-3 items-center">
          {/* Step 1 */}
          <button
            onClick={() => setShowInit(true)}
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition"
          >
            <FiCpu className="w-4 h-4" /> Initialize New Model
          </button>

          {/* Step 2 */}
          <button
            onClick={handleStartRound}
            disabled={!activeModel}
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FiPlay className="w-4 h-4" /> Start FL Round
          </button>

          {/* Step 3 — simulate */}
          <button
            onClick={handleSimulateAll}
            disabled={!activeRound || simulatingAll || activeRound?.status !== 'training'}
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FiUsers className={`w-4 h-4 ${simulatingAll ? 'animate-pulse' : ''}`} />
            {simulatingAll ? 'Simulating… (real data)' : 'Simulate All Hospitals'}
          </button>

          {/* Step 4 — FedAvg */}
          <button
            onClick={handleAggregate}
            disabled={!activeRound}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed ${
              simulateResults && simulateResults.length > 0
                ? 'bg-orange-500 text-white hover:bg-orange-600 ring-2 ring-orange-300 ring-offset-1 animate-pulse'
                : 'bg-orange-500 text-white hover:bg-orange-600'
            }`}
          >
            <FiZap className="w-4 h-4" /> Run FedAvg Aggregation
          </button>

          {/* Send Reminder — amber */}
          {activeRound?.status === 'training' && pendingHospitals.length > 0 && (
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder}
              className="inline-flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-40"
            >
              <FiBell className={`w-4 h-4 ${sendingReminder ? 'animate-bounce' : ''}`} />
              {sendingReminder ? 'Sending…' : `Remind ${pendingHospitals.length} Pending`}
            </button>
          )}

          {/* Force Aggregate — red */}
          {canForceAggregate && (
            <button
              onClick={handleForceAggregate}
              disabled={forcingAggregate}
              className="inline-flex items-center gap-2 bg-danger text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-600 transition disabled:opacity-40"
            >
              <FiAlertTriangle className="w-4 h-4" />
              {forcingAggregate ? 'Forcing…' : 'Force Aggregate'}
            </button>
          )}

          {/* Lower Threshold — blue */}
          {activeRound && (activeRound.status === 'training' || activeRound.status === 'aggregating') && (
            <button
              onClick={() => {
                setNewThreshold(String(activeRound.min_hospitals_threshold ?? ''));
                setShowThresholdModal(true);
              }}
              className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition"
            >
              📉 Lower Threshold
            </button>
          )}

          {/* Cancel Round — orange */}
          {activeRound && (activeRound.status === 'training' || activeRound.status === 'aggregating' || activeRound.status === 'pending') && (
            <button
              onClick={handleCancelRound}
              disabled={cancellingRound}
              className="inline-flex items-center gap-2 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50"
            >
              <FiAlertTriangle className="w-4 h-4" />
              {cancellingRound ? 'Cancelling…' : 'Cancel Round'}
            </button>
          )}

          {/* Reset — danger, pushed to the right */}
          <button
            onClick={handleReset}
            disabled={resetting}
            className="inline-flex items-center gap-2 border border-red-200 text-red-500 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-red-50 transition ml-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FiTrash2 className={`w-4 h-4 ${resetting ? 'animate-pulse' : ''}`} />
            {resetting ? 'Resetting…' : 'Reset FL Data'}
          </button>
        </div>

        {/* Active round status */}
        {activeRound && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span>
              Active round: <strong className="text-gray-700">Round {activeRound.round_number}</strong>
            </span>
            <span>
              Status:{' '}
              <span className={`font-semibold capitalize ${
                activeRound.status === 'training'    ? 'text-blue-500'  :
                activeRound.status === 'aggregating' ? 'text-purple-500' :
                'text-yellow-600'
              }`}>
                {activeRound.status}
              </span>
            </span>
            <span>{completed}/{invited} hospitals completed</span>
            {activeRound.reminder_sent && (
              <span className="text-amber-600 font-medium">Reminder sent</span>
            )}
            {activeRound.auto_aggregated && (
              <span className="text-purple-600 font-medium">Force-aggregated</span>
            )}
          </div>
        )}

        {/* Simulate results */}
        {simulateResults && simulateResults.length > 0 && (() => {
          const total = simulateResults.length;
          const avgAcc = (simulateResults.reduce((s, r) => s + (r.local_accuracy || 0), 0) / total).toFixed(1);
          return (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm">
                <span className="text-green-700 font-semibold">
                  {total}/{activeRound?.hospitals_invited ?? total} hospitals trained successfully
                </span>
                <span className="text-gray-600">
                  Average local accuracy: <strong className="text-green-700">{avgAcc}%</strong>
                </span>
                <span className="text-gray-600 font-medium">Ready for FedAvg Aggregation!</span>
                <button onClick={() => setSimulateResults(null)} className="ml-auto text-gray-400 hover:text-gray-600">
                  <FiX className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="border border-blue-100 rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-blue-50">
                  <span className="text-xs font-semibold text-blue-700">Per-Hospital Simulation Results</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 uppercase tracking-wide text-left">
                      <th className="px-4 py-2">Hospital</th>
                      <th className="px-4 py-2">Patients</th>
                      <th className="px-4 py-2">Samples</th>
                      <th className="px-4 py-2">Data Source</th>
                      <th className="px-4 py-2">Accuracy</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {simulateResults.map((r, i) => {
                      const src = r.data_source || '';
                      const isHybrid = src.includes('real(') && src.includes('kaggle(');
                      const isRealOnly = src.startsWith('real(') && !src.includes('kaggle(');
                      const badgeLabel = isHybrid ? 'Hybrid' : isRealOnly ? 'Real Only' : 'Kaggle Only';
                      const badgeCls = isHybrid
                        ? 'bg-green-100 text-green-700'
                        : isRealOnly
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-yellow-100 text-yellow-700';
                      return (
                        <tr key={i} className="hover:bg-blue-50/30">
                          <td className="px-4 py-2 font-medium text-gray-800">{r.hospital_name}</td>
                          <td className="px-4 py-2 text-gray-700">{r.patient_count ?? 0}</td>
                          <td className="px-4 py-2 text-gray-600">{(r.training_samples ?? 0).toLocaleString()}</td>
                          <td className="px-4 py-2">
                            <span className={`inline-block px-2 py-0.5 rounded-full font-semibold text-[11px] ${badgeCls}`}>
                              {badgeLabel}
                            </span>
                            <span className="ml-1.5 text-gray-400">{src}</span>
                          </td>
                          <td className="px-4 py-2 font-semibold text-green-600">{r.local_accuracy}%</td>
                          <td className="px-4 py-2">
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                              <FiCheck className="w-3 h-3" /> Done
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Pending hospitals panel */}
      {activeRound?.status === 'training' && pendingHospitals.length > 0 && (
        <section className="card mb-6 border border-amber-100 bg-amber-50/30">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FiAlertTriangle className="w-4 h-4 text-amber-500" />
              <h2 className="text-sm font-semibold text-amber-700">
                Pending Hospitals ({pendingHospitals.length})
              </h2>
            </div>
            <button
              onClick={handleSendReminder}
              disabled={sendingReminder}
              className="inline-flex items-center gap-1.5 text-xs font-semibold bg-amber-500 text-white px-3 py-1.5 rounded-lg hover:bg-amber-600 transition disabled:opacity-50"
            >
              <FiBell className="w-3.5 h-3.5" />
              {sendingReminder ? 'Sending…' : 'Send Reminder to All'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {pendingHospitals.map((h) => (
              <div
                key={h.hospital_id}
                className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-gray-700"
              >
                <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
                {h.hospital_name}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Accuracy chart */}
      <section className="card mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Accuracy Trend (Completed Rounds)</h2>
        {accuracyTrend.length === 0 ? (
          <div className="text-center text-gray-400 py-10 text-sm">
            No completed rounds yet. Complete the steps above to see accuracy improve!
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={accuracyTrend} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="round" stroke="#6b7280" fontSize={12} />
              <YAxis domain={[0, 100]} unit="%" stroke="#6b7280" fontSize={12} />
              <Tooltip
                contentStyle={{ borderRadius: '10px', border: '1px solid #e5e7eb', fontSize: 12 }}
                formatter={(v) => [`${v}%`, 'Accuracy']}
              />
              <Line
                type="monotone"
                dataKey="accuracy"
                stroke="#00D4FF"
                strokeWidth={3}
                dot={{ fill: '#1A3C6E', r: 5 }}
                activeDot={{ r: 7 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* Rounds table */}
      <section className="card mb-6 p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">FL Rounds</h2>
        </div>
        {rounds.loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Loading rounds…</div>
        ) : roundsList.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">
            No rounds yet. Initialize a model and start a round.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Round</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Hospitals</th>
                  <th className="px-4 py-3">Threshold</th>
                  <th className="px-4 py-3">Loss</th>
                  <th className="px-4 py-3">Deadline</th>
                  <th className="px-4 py-3">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {roundsList.map((r) => (
                  <tr key={r.round_id} className="hover:bg-primary-50/30 transition">
                    <td className="px-4 py-3 font-semibold text-primary-500">Round {r.round_number}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${
                        r.status === 'completed'   ? 'bg-green-100  text-green-700'  :
                        r.status === 'training'    ? 'bg-blue-100   text-blue-700'   :
                        r.status === 'aggregating' ? 'bg-purple-100 text-purple-700' :
                        r.status === 'cancelled'   ? 'bg-gray-200   text-gray-600'   :
                                                     'bg-yellow-100 text-yellow-700'
                      }`}>
                        {r.status === 'training' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                        )}
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.hospitals_completed}/{r.hospitals_invited}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{r.min_hospitals_threshold} min</td>
                    <td className="px-4 py-3 text-gray-600">
                      {r.global_loss ? Number(r.global_loss).toFixed(4) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(r.round_deadline)}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(r.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hospital weights detail */}
      {weightsData && weightsData.submissions?.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              Hospital Weights — Round {weightsData.round?.round_number}
            </h2>
            <button onClick={() => setWeightsData(null)} className="text-gray-400 hover:text-gray-600">
              <FiX className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Hospital</th>
                  <th className="px-4 py-3">Local Accuracy</th>
                  <th className="px-4 py-3">Loss</th>
                  <th className="px-4 py-3">Samples</th>
                  <th className="px-4 py-3">Submitted</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(weightsData.submissions || []).map((s) => (
                  <tr key={s.weight_id} className="hover:bg-primary-50/30">
                    <td className="px-4 py-3 font-medium text-gray-800">{s.hospital_name || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-green-600">
                      {s.local_accuracy ? `${Number(s.local_accuracy).toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {s.local_loss ? Number(s.local_loss).toFixed(4) : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {s.training_samples ? Number(s.training_samples).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.submitted_at)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                        <FiCheck className="w-3 h-3" /> Submitted
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {showInit && (
        <InitModal
          onClose={() => setShowInit(false)}
          onSuccess={() => { dashboard.refetch(); rounds.refetch(); }}
        />
      )}

      {showExtend && (
        <ExtendModal
          onClose={() => setShowExtend(false)}
          onExtend={handleExtendDeadline}
        />
      )}

      {showThresholdModal && activeRound && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowThresholdModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-bold text-primary-500">Lower Minimum Threshold</h3>
              <button
                onClick={() => setShowThresholdModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <FiX />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-gray-600">
                Current threshold: <strong>{activeRound.min_hospitals_threshold}</strong>
              </p>
              <p className="text-sm text-gray-600">
                Hospitals completed: <strong>{activeRound.hospitals_completed}</strong> / {activeRound.hospitals_invited}
              </p>
              <input
                type="number"
                min="1"
                max={activeRound.hospitals_invited || undefined}
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                placeholder="Enter new threshold"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
              />
              <p className="text-xs text-orange-500">
                ⚠️ Lowering the threshold allows aggregation with fewer hospitals. Use only if the deadline was extended and not enough hospitals responded.
              </p>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={handleLowerThreshold}
                  disabled={updatingThreshold}
                  className="flex-1 bg-orange-500 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-orange-600 transition disabled:opacity-50"
                >
                  {updatingThreshold ? 'Updating…' : 'Update Threshold'}
                </button>
                <button
                  onClick={() => setShowThresholdModal(false)}
                  className="flex-1 bg-gray-100 text-gray-600 px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-200 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </DashboardLayout>
  );
};

export default FLMonitor;
