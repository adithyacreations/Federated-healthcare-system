import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiSearch, FiX, FiAlertOctagon, FiRefreshCw } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const SEVERITY_STYLES = {
  low: 'bg-success/10 text-success border-success/30',
  moderate: 'bg-yellow-50 text-warning border-yellow-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-red-50 text-danger border-red-200',
};

const SymptomChecker = () => {
  const symptoms = useApi('/api/ai/symptoms-list/');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // FL maintenance check — disables the AI submit and shows a banner while a
  // new global model is being aggregated.
  const [flMaintenance, setFlMaintenance] = useState(false);
  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const res = await API.get('/api/fl/maintenance-status/');
        if (res.data?.success) setFlMaintenance(Boolean(res.data.data?.maintenance_mode));
      } catch (e) { /* best-effort */ }
    };
    checkMaintenance();
    const id = setInterval(checkMaintenance, 60000);
    return () => clearInterval(id);
  }, []);

  const all = useMemo(() => symptoms.data?.symptoms || [], [symptoms.data]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) => s.toLowerCase().includes(q));
  }, [all, search]);

  const toggle = (s) => {
    setSelected((cur) => {
      if (cur.includes(s)) return cur.filter((x) => x !== s);
      if (cur.length >= 10) {
        toast.error('Max 10 symptoms');
        return cur;
      }
      return [...cur, s];
    });
  };

  const submit = async () => {
    if (selected.length === 0) return toast.error('Pick at least one symptom');
    setBusy(true);
    setResult(null);
    try {
      const { data } = await API.post('/api/ai/symptom-check/', { symptoms: selected });
      setResult(data?.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Symptom check failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setSelected([]);
    setSearch('');
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-500">AI Symptom Checker</h1>
        <p className="text-sm text-gray-500">
          Pick the symptoms you're experiencing. Our AI will suggest possible conditions.
        </p>
      </div>

      {flMaintenance && (
        <div
          className="rounded-2xl p-4 mb-4 border-2 flex items-center gap-3"
          style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
        >
          <span className="text-2xl">🔧</span>
          <div>
            <p className="font-bold" style={{ color: '#F97316' }}>
              AI Under Maintenance
            </p>
            <p className="text-sm text-gray-500">
              The FL model is being retrained. Please try again later.
            </p>
          </div>
        </div>
      )}

      <AnimatePresence mode="wait">
        {!result ? (
          <motion.div key="select" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {/* Selected pills */}
            {selected.length > 0 && (
              <div className="card mb-5">
                <div className="text-xs uppercase text-gray-500 mb-2">
                  Selected ({selected.length}/10)
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.map((s) => (
                    <button
                      key={s}
                      onClick={() => toggle(s)}
                      className="inline-flex items-center gap-1 bg-orange-500 text-white px-3 py-1.5 rounded-full text-sm hover:bg-orange-600"
                    >
                      {s.replace(/_/g, ' ')}
                      <FiX className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Search */}
            <div className="card">
              <div className="relative mb-4">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search symptoms…"
                  className="input-field pl-10"
                />
              </div>

              {symptoms.loading ? (
                <div className="text-sm text-gray-500">Loading symptoms…</div>
              ) : (
                <div className="flex flex-wrap gap-2 max-h-[28rem] overflow-y-auto">
                  {filtered.map((s) => {
                    const active = selected.includes(s);
                    return (
                      <button
                        key={s}
                        onClick={() => toggle(s)}
                        className={`px-3 py-1.5 rounded-full text-sm border transition ${
                          active
                            ? 'bg-orange-500 text-white border-primary-500'
                            : 'border-gray-200 text-gray-700 hover:border-primary-300 hover:bg-primary-50'
                        }`}
                      >
                        {s.replace(/_/g, ' ')}
                      </button>
                    );
                  })}
                  {filtered.length === 0 && (
                    <div className="text-sm text-gray-500">No symptoms match "{search}".</div>
                  )}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={submit}
                disabled={busy || flMaintenance || selected.length === 0}
                className="btn-primary disabled:opacity-60"
              >
                {flMaintenance
                  ? '🔧 Under Maintenance'
                  : busy
                    ? 'Analyzing…'
                    : `Check Symptoms (${selected.length})`}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="result" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* Severity badge */}
            <div className={`card mb-5 border-2 ${SEVERITY_STYLES[result.severity] || ''}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide opacity-70 mb-1">Severity</div>
                  <div className={`text-3xl font-bold uppercase ${result.severity === 'critical' ? 'animate-pulse' : ''}`}>
                    {result.severity}
                  </div>
                </div>
                <FiAlertOctagon className="w-12 h-12 opacity-30" />
              </div>
              <p className="mt-3 text-sm leading-relaxed">{result.recommendation}</p>
            </div>

            {/* Emergency banner */}
            {result.emergency_triggered && (
              <div className="card bg-red-50 border-2 border-red-200 mb-5">
                <div className="font-bold text-danger mb-1">⚠️ High Severity Detected</div>
                <p className="text-sm text-red-900 mb-3">
                  Please seek immediate medical attention. Don't delay.
                </p>
                <Link to="/patient" className="btn-danger inline-block">Go to Emergency SOS</Link>
              </div>
            )}

            {/* Predicted diseases */}
            <div className="card mb-5">
              <h3 className="font-semibold text-primary-500 mb-4">Possible Conditions</h3>
              <div className="space-y-3">
                {(result.predicted_diseases || []).map((d, i) => (
                  <div key={`${d.disease}-${i}`}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{d.disease}</span>
                      <span className="text-primary-500 font-semibold">{d.probability}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(d.probability, 100)}%` }}
                        transition={{ duration: 0.6, delay: i * 0.1 }}
                        className="h-full bg-gradient-to-r from-primary-400 to-accent rounded-full"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-gray-400 mt-4">
                Model: {result.model_used === 'ml_model' ? 'Trained ML' : 'Rule-based'} · v{result.model_version}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link to="/patient/doctors" className="btn-primary">Book a Doctor</Link>
              <button onClick={reset} className="btn-secondary inline-flex items-center gap-2">
                <FiRefreshCw /> Check Again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </DashboardLayout>
  );
};

export default SymptomChecker;
