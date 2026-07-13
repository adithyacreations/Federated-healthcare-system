import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const symptoms = useApi('/api/ai/symptoms-list/');
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  // ── Tabs: classic symptom checker vs. AI skin-disease screening ───────────
  const [activeTab, setActiveTab] = useState('symptoms');
  const [skinImage, setSkinImage] = useState(null);
  const [skinPreview, setSkinPreview] = useState(null);
  const [skinAnalyzing, setSkinAnalyzing] = useState(false);
  const [skinResult, setSkinResult] = useState(null);
  const [skinError, setSkinError] = useState('');

  const handleSkinImageSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSkinImage(file);
    setSkinResult(null);
    setSkinError('');
    const reader = new FileReader();
    reader.onloadend = () => setSkinPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSkinAnalysis = async () => {
    if (!skinImage) {
      toast.error('Please upload a skin photo!');
      return;
    }
    try {
      setSkinAnalyzing(true);
      setSkinResult(null);
      setSkinError('');

      const formData = new FormData();
      formData.append('image', skinImage);

      const response = await API.post('/api/ai/skin-disease/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      if (response.data?.success) {
        setSkinResult(response.data.data);
      } else {
        setSkinError(response.data?.message || 'Analysis failed!');
      }
    } catch (error) {
      setSkinError(
        error.response?.data?.message || 'Analysis failed! Please try again.'
      );
    } finally {
      setSkinAnalyzing(false);
    }
  };

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

      {/* Tabs: Symptom Checker | Skin Check */}
      <div
        style={{
          display: 'flex', gap: 8, marginBottom: 24, backgroundColor: 'white',
          padding: 6, borderRadius: 16, border: '1px solid #E5E5E5',
        }}
      >
        {[
          { id: 'symptoms', label: '💊 Symptom Checker' },
          { id: 'skin', label: '🔬 Skin Check' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              flex: 1, padding: 12, borderRadius: 12, border: 'none',
              backgroundColor: activeTab === t.id ? '#F97316' : 'transparent',
              color: activeTab === t.id ? 'white' : '#666',
              fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'symptoms' && (
        <>
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
              <div className="flex gap-2 sm:gap-3 mb-4 items-center">
                <div className="relative flex-1">
                  <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search symptoms…"
                    className="input-field pl-10"
                  />
                </div>
                <button
                  onClick={submit}
                  disabled={busy || flMaintenance || selected.length === 0}
                  className="btn-primary disabled:opacity-60 whitespace-nowrap shrink-0 px-3 sm:px-5"
                >
                  {flMaintenance
                    ? '🔧 Maintenance'
                    : busy
                      ? 'Analyzing…'
                      : `Check Symptoms (${selected.length})`}
                </button>
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
                <Link to="/patient/emergency" className="btn-danger inline-block">Go to Emergency SOS</Link>
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
              <Link to="/patient/consultations" className="btn-primary">Book a Doctor</Link>
              <button onClick={reset} className="btn-secondary inline-flex items-center gap-2">
                <FiRefreshCw /> Check Again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
        </>
      )}

      {activeTab === 'skin' && (
        <div>
          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 6px' }}>
              🔬 Skin Disease Screening
            </h2>
            <p style={{ color: '#666', fontSize: 14, margin: 0 }}>
              Upload a photo of your skin concern for AI screening
            </p>
          </div>

          {/* Disclaimer banner */}
          <div
            style={{
              backgroundColor: '#FFF7ED', border: '1.5px solid #FED7AA', borderRadius: 12,
              padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: 20 }}>⚕️</span>
            <div>
              <p style={{ fontWeight: 700, color: '#F97316', margin: '0 0 4px', fontSize: 13 }}>
                Medical Disclaimer
              </p>
              <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5 }}>
                This is an AI screening tool only. Results are NOT a medical diagnosis.
                Always consult a qualified dermatologist for proper evaluation.
              </p>
            </div>
          </div>

          {/* Upload */}
          <div
            style={{
              backgroundColor: 'white', borderRadius: 16, padding: 20,
              border: '1px solid #E5E5E5', marginBottom: 16,
            }}
          >
            <label
              htmlFor="skin-upload"
              style={{
                display: 'block', border: `2px dashed ${skinPreview ? '#F97316' : '#E5E5E5'}`,
                borderRadius: 12, padding: skinPreview ? 12 : '32px 20px', textAlign: 'center',
                cursor: 'pointer', marginBottom: 16, transition: 'all 0.2s',
              }}
            >
              <input
                id="skin-upload"
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleSkinImageSelect}
              />
              {skinPreview ? (
                <div>
                  <img
                    src={skinPreview}
                    alt="Skin preview"
                    style={{ maxWidth: '100%', maxHeight: 250, borderRadius: 10, objectFit: 'contain' }}
                  />
                  <p style={{ fontSize: 12, color: '#F97316', marginTop: 8, fontWeight: 600 }}>
                    ✅ {skinImage?.name} — Click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 48, margin: '0 0 10px' }}>🔬</p>
                  <p style={{ fontWeight: 700, color: '#333', fontSize: 15, margin: '0 0 6px' }}>
                    Upload Skin Photo
                  </p>
                  <p style={{ fontSize: 12, color: '#9CA3AF', margin: '0 0 8px' }}>
                    Take a clear close-up photo of the affected skin area
                  </p>
                  <p style={{ fontSize: 11, color: '#C4C4C4', margin: 0 }}>JPG, PNG supported</p>
                </div>
              )}
            </label>

            {/* Tips */}
            <div style={{ backgroundColor: '#F0FDF4', borderRadius: 10, padding: '10px 14px', marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: '#16A34A', fontWeight: 600, margin: '0 0 4px' }}>
                📸 Tips for better results:
              </p>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: '#666' }}>
                <li>Use good lighting</li>
                <li>Take close-up photo</li>
                <li>Keep camera steady</li>
                <li>Show the affected area clearly</li>
              </ul>
            </div>

            <button
              onClick={handleSkinAnalysis}
              disabled={!skinImage || skinAnalyzing}
              style={{
                width: '100%', padding: 14,
                backgroundColor: skinImage && !skinAnalyzing ? '#F97316' : '#E5E5E5',
                color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15,
                cursor: skinImage && !skinAnalyzing ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {skinAnalyzing ? (
                <>
                  <span
                    className="animate-spin"
                    style={{
                      width: 18, height: 18, border: '2px solid white',
                      borderTopColor: 'transparent', borderRadius: '50%', display: 'inline-block',
                    }}
                  />
                  Analyzing...
                </>
              ) : '🔬 Analyze Skin Photo'}
            </button>
          </div>

          {/* Error */}
          {skinError && (
            <div
              style={{
                backgroundColor: '#FEF2F2', borderRadius: 12, padding: '12px 16px',
                marginBottom: 16, border: '1px solid #FCA5A5',
              }}
            >
              <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>❌ {skinError}</p>
            </div>
          )}

          {/* Result */}
          {skinResult && (
            <div
              style={{
                backgroundColor: 'white', borderRadius: 16, overflow: 'hidden',
                border: `2px solid ${skinResult.is_urgent ? '#FCA5A5' : '#86EFAC'}`, marginBottom: 16,
              }}
            >
              <div
                style={{
                  padding: '16px 20px', backgroundColor: skinResult.is_urgent ? '#EF4444' : '#22C55E',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}
              >
                <p style={{ color: 'white', fontWeight: 800, margin: 0, fontSize: 15 }}>
                  🔬 Screening Result
                </p>
                {skinResult.is_urgent && (
                  <span
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '3px 10px',
                      borderRadius: 999, fontSize: 12, fontWeight: 700,
                    }}
                  >
                    ⚠️ See Doctor Soon
                  </span>
                )}
              </div>

              <div style={{ padding: 20, backgroundColor: skinResult.is_urgent ? '#FEF2F2' : '#F0FDF4' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
                  <div
                    style={{
                      width: 72, height: 72, borderRadius: '50%',
                      backgroundColor: skinResult.is_urgent ? '#EF4444' : '#22C55E',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0,
                    }}
                  >
                    <span style={{ color: 'white', fontSize: 18, fontWeight: 900 }}>
                      {skinResult.confidence.toFixed(0)}%
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 9 }}>confidence</span>
                  </div>
                  <div>
                    <p
                      style={{
                        fontSize: 11, color: '#9CA3AF', margin: '0 0 4px',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                      }}
                    >
                      Possible Condition
                    </p>
                    <p style={{ fontWeight: 800, fontSize: 17, color: '#000', margin: '0 0 4px' }}>
                      {skinResult.predicted_label}
                    </p>
                    <p style={{ fontSize: 12, color: '#666', margin: 0 }}>
                      Model accuracy: {(skinResult.model_accuracy * 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 8, overflow: 'hidden', marginBottom: 16 }}>
                  <div
                    style={{
                      width: `${skinResult.confidence}%`, height: '100%',
                      backgroundColor: skinResult.is_urgent ? '#EF4444' : '#22C55E',
                      borderRadius: 999, transition: 'width 1s ease',
                    }}
                  />
                </div>

                <p style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 10 }}>
                  All Categories:
                </p>
                {skinResult.all_predictions.map((pred, i) => (
                  <div key={i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: i === 0 ? 700 : 400, color: i === 0 ? '#000' : '#666' }}>
                        {i === 0 ? '▶ ' : ''}{pred.label}
                      </span>
                      <span
                        style={{
                          fontSize: 12, fontWeight: 700,
                          color: i === 0 ? (skinResult.is_urgent ? '#EF4444' : '#22C55E') : '#9CA3AF',
                        }}
                      >
                        {pred.probability.toFixed(1)}%
                      </span>
                    </div>
                    <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 5, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${pred.probability}%`, height: '100%',
                          backgroundColor: i === 0 ? (skinResult.is_urgent ? '#EF4444' : '#F97316') : '#D1D5DB',
                          borderRadius: 999,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {skinResult.is_urgent && (
                <div style={{ padding: '14px 20px', backgroundColor: '#FEF2F2', borderTop: '1px solid #FCA5A5' }}>
                  <p style={{ fontWeight: 700, color: '#EF4444', fontSize: 13, margin: '0 0 4px' }}>
                    ⚠️ Important Notice
                  </p>
                  <p style={{ fontSize: 12, color: '#666', margin: 0, lineHeight: 1.5 }}>
                    The AI detected possible signs of a serious skin condition. Please consult a
                    dermatologist as soon as possible for proper evaluation.
                  </p>
                </div>
              )}

              <div style={{ padding: '16px 20px', display: 'flex', gap: 10, backgroundColor: 'white' }}>
                <button
                  onClick={() => navigate('/patient/consultations?dept=dermatology')}
                  style={{
                    flex: 1, padding: 12, backgroundColor: '#F97316', color: 'white', border: 'none',
                    borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  👨‍⚕️ Book Dermatologist
                </button>
                <button
                  onClick={() => { setSkinResult(null); setSkinImage(null); setSkinPreview(null); }}
                  style={{
                    flex: 1, padding: 12, backgroundColor: 'white', color: '#666',
                    border: '1.5px solid #E5E5E5', borderRadius: 12, fontWeight: 600, fontSize: 13, cursor: 'pointer',
                  }}
                >
                  🔄 Check Another
                </button>
              </div>

              <div style={{ padding: '12px 20px', backgroundColor: '#F9FAFB', borderTop: '1px solid #E5E5E5' }}>
                <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, fontStyle: 'italic', textAlign: 'center' }}>
                  ⚕️ {skinResult.disclaimer}
                </p>
              </div>
            </div>
          )}

          {/* What we detect */}
          <div style={{ backgroundColor: 'white', borderRadius: 16, padding: '16px 20px', border: '1px solid #E5E5E5' }}>
            <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 8px' }}>🔬 What We Detect:</p>
            {[
              { icon: '⚠️', name: 'Melanoma', desc: 'Serious skin cancer — immediate attention needed', color: '#EF4444' },
              { icon: '🔴', name: 'Skin Cancer (BCC)', desc: 'Basal cell carcinoma — requires treatment', color: '#F97316' },
              { icon: '🟡', name: 'Benign Lesion', desc: 'Non-cancerous moles and growths', color: '#F59E0B' },
              { icon: '🟢', name: 'Inflammatory/Infection', desc: 'Eczema, psoriasis, fungal conditions', color: '#22C55E' },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0',
                  borderBottom: i < 3 ? '1px solid #F5F5F5' : 'none',
                }}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <div>
                  <p style={{ fontWeight: 600, fontSize: 13, color: item.color, margin: '0 0 2px' }}>{item.name}</p>
                  <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default SymptomChecker;
