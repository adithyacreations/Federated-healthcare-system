import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import API from '../../api/axios';

// EHR access is remembered per patient in sessionStorage for 2 hours, so the
// doctor isn't re-prompted for the code every time they switch tabs (this panel
// unmounts when its tab is hidden) or briefly reload during a consultation.
const EHR_TTL_MS = 2 * 60 * 60 * 1000;
const ehrKey = (id) => `ehr_access_${id}`;

const isEhrAccessValid = (id) => {
  if (!id) return false;
  try {
    const raw = sessionStorage.getItem(ehrKey(id));
    if (!raw) return false;
    const { grantedAt } = JSON.parse(raw);
    if (grantedAt && Date.now() - grantedAt < EHR_TTL_MS) return true;
    sessionStorage.removeItem(ehrKey(id));
  } catch { /* ignore malformed entry */ }
  return false;
};

const grantEhrAccess = (id) => {
  if (!id) return;
  try {
    sessionStorage.setItem(ehrKey(id), JSON.stringify({ grantedAt: Date.now() }));
  } catch { /* storage unavailable — access still works for this mount */ }
};

// Which AI imaging models are relevant to a doctor's specialty. Keywords are
// matched (substring) against the doctor's specialization.
const DEPARTMENT_AI_MODELS = {
  neuro: ['neurology', 'neurosurgery', 'neurologist', 'neuro'],
  chest: ['pulmonology', 'pulmonologist', 'general medicine', 'general physician',
    'internal medicine', 'respiratory', 'chest', 'critical care'],
  cardiac: ['cardiology', 'cardiologist', 'cardiac'],
  skin: ['dermatology', 'dermatologist', 'skin'],
  general: ['general', 'family medicine', 'primary care', 'medicine'],
};

const getAvailableModels = (department) => {
  const models = ['symptom_checker'];
  const dept = (department || '').toLowerCase().trim();
  // Unknown specialty → show everything (don't cripple the tools).
  if (!dept) return [...new Set([...models, 'pneumonia', 'chest_multilabel', 'brain_mri'])];

  if (DEPARTMENT_AI_MODELS.neuro.some((d) => dept.includes(d))) models.push('brain_mri');
  if (DEPARTMENT_AI_MODELS.chest.some((d) => dept.includes(d))) models.push('pneumonia', 'chest_multilabel');
  if (DEPARTMENT_AI_MODELS.cardiac.some((d) => dept.includes(d))) models.push('pneumonia', 'chest_multilabel');
  if (DEPARTMENT_AI_MODELS.skin.some((d) => dept.includes(d))) models.push('skin_disease');
  if (DEPARTMENT_AI_MODELS.general.some((d) => dept.includes(d))) models.push('pneumonia', 'chest_multilabel', 'brain_mri');

  // No specialty match → fall back to all imaging models.
  if (models.length === 1) models.push('pneumonia', 'chest_multilabel', 'brain_mri');
  return [...new Set(models)];
};

const clearBtn = {
  fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none',
  padding: 0, marginTop: 4, cursor: 'pointer', textDecoration: 'underline',
};

// ── Pneumonia (binary) result ──────────────────────────────────────────────
const PneumoniaResultCard = ({ data, onClear }) => {
  const positive = data.predicted_class === 'PNEUMONIA';
  const accent = positive ? '#EF4444' : '#22C55E';
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12, border: `2px solid ${positive ? '#FCA5A5' : '#86EFAC'}` }}>
      <div style={{ padding: '12px 16px', backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: 'white', fontWeight: 700, margin: 0, fontSize: 14 }}>🫁 Pneumonia Detection</p>
        <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
          {positive ? '⚠️ Detected' : '✅ Normal'}
        </span>
      </div>
      <div style={{ backgroundColor: positive ? '#FEF2F2' : '#F0FDF4', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontWeight: 900, fontSize: 16 }}>{data.confidence}%</span>
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 16, color: '#000', margin: '0 0 4px' }}>{positive ? 'Pneumonia Detected' : 'No Pneumonia Found'}</p>
            <p style={{ fontSize: 12, color: '#666', margin: 0 }}>Confidence: {data.confidence}%</p>
          </div>
        </div>
        <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 8, overflow: 'hidden' }}>
          <div style={{ width: `${data.confidence}%`, height: '100%', backgroundColor: accent, borderRadius: 999, transition: 'width 1s ease' }} />
        </div>
        <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 10, fontStyle: 'italic' }}>⚕️ AI screening only. Confirm with radiologist.</p>
        <button onClick={onClear} style={clearBtn}>Clear result</button>
      </div>
    </div>
  );
};

// ── Chest multi-label (13 conditions, pneumonia excluded) result ───────────
const ChestResultCard = ({ data, onClear }) => (
  <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12, border: `2px solid ${data.is_normal ? '#86EFAC' : '#FCA5A5'}` }}>
    <div style={{ padding: '12px 16px', backgroundColor: data.is_normal ? '#22C55E' : '#F97316', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <p style={{ color: 'white', fontWeight: 700, margin: 0, fontSize: 14 }}>📊 Chest Analysis (13 Conditions)</p>
      <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
        {data.is_normal ? '✅ All Clear' : `⚠️ ${data.total_detected} Found`}
      </span>
    </div>
    {!data.is_normal && (
      <div style={{ backgroundColor: '#FEF2F2', padding: '12px 16px', borderBottom: '1px solid #FCA5A5' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#EF4444', marginBottom: 8 }}>⚠️ Conditions Detected:</p>
        {data.detected_conditions.map((cond, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: 13, color: '#000', margin: 0 }}>{cond.condition}</p>
              <p style={{ fontSize: 11, color: '#666', margin: 0 }}>{cond.description}</p>
            </div>
            <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: 'white', fontSize: 11, fontWeight: 700 }}>{cond.probability}%</span>
            </div>
          </div>
        ))}
      </div>
    )}
    <div style={{ backgroundColor: '#F9FAFB', padding: '12px 16px' }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 10 }}>All Conditions:</p>
      {data.all_conditions.map((cond, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <span style={{ fontSize: 12, fontWeight: cond.detected ? 700 : 400, color: cond.detected ? '#EF4444' : '#666' }}>
              {cond.detected ? '⚠️ ' : '✓ '}{cond.condition}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: cond.detected ? '#EF4444' : '#9CA3AF' }}>{cond.probability}%</span>
          </div>
          <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 5, overflow: 'hidden' }}>
            <div style={{ width: `${cond.probability}%`, height: '100%', backgroundColor: cond.detected ? '#EF4444' : '#9CA3AF', borderRadius: 999 }} />
          </div>
        </div>
      ))}
      <div style={{ marginTop: 12, backgroundColor: '#FFF7ED', borderRadius: 8, padding: '8px 12px' }}>
        <p style={{ fontSize: 11, color: '#F97316', margin: 0, fontWeight: 600 }}>💡 For pneumonia, use the dedicated Pneumonia Check button for better accuracy.</p>
      </div>
    </div>
    <div style={{ padding: '10px 16px', backgroundColor: 'white' }}>
      <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0, fontStyle: 'italic' }}>⚕️ {data.disclaimer || 'AI screening only. Confirm with radiologist.'}</p>
      <button onClick={onClear} style={clearBtn}>Clear result</button>
    </div>
  </div>
);

// ── Brain MRI tumor result ─────────────────────────────────────────────────
const BrainResultCard = ({ data, onClear }) => {
  const tumor = data.is_tumor;
  const accent = tumor ? '#EF4444' : '#22C55E';
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12, border: `2px solid ${tumor ? '#FCA5A5' : '#86EFAC'}` }}>
      <div style={{ padding: '12px 16px', backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: 'white', fontWeight: 700, margin: 0, fontSize: 14 }}>🧠 Brain MRI Analysis</p>
        <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
          {tumor ? '⚠️ Tumor Detected' : '✅ No Tumor'}
        </span>
      </div>
      <div style={{ backgroundColor: tumor ? '#FEF2F2' : '#F0FDF4', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 72, height: 72, borderRadius: '50%', backgroundColor: accent, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontSize: 18, fontWeight: 900 }}>{data.confidence}%</span>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 9 }}>confidence</span>
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#000', margin: '0 0 4px' }}>{data.predicted_label}</p>
            <p style={{ fontSize: 12, color: '#666', margin: 0 }}>{tumor ? '⚠️ Tumor found in MRI scan' : '✅ No tumor detected'}</p>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: '4px 0 0' }}>Model accuracy: {(data.model_accuracy * 100).toFixed(1)}%</p>
          </div>
        </div>
        {data.all_predictions.map((pred, i) => {
          const hi = i === 0;
          const col = hi ? accent : '#9CA3AF';
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: hi ? 700 : 400, color: hi ? col : '#666' }}>{pred.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{pred.probability}%</span>
              </div>
              <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 6, overflow: 'hidden' }}>
                <div style={{ width: `${pred.probability}%`, height: '100%', backgroundColor: hi ? col : '#D1D5DB', borderRadius: 999, transition: 'width 0.8s ease' }} />
              </div>
            </div>
          );
        })}
        <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 12, fontStyle: 'italic' }}>⚕️ {data.disclaimer}</p>
        <button onClick={onClear} style={clearBtn}>Clear result</button>
      </div>
    </div>
  );
};

// ── Skin disease (4-class) result ──────────────────────────────────────────
const SkinResultCard = ({ data, onClear }) => {
  const urgent = data.is_urgent;
  const accent = urgent ? '#EF4444' : '#22C55E';
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', marginTop: 12, border: `2px solid ${urgent ? '#FCA5A5' : '#86EFAC'}` }}>
      <div style={{ padding: '12px 16px', backgroundColor: accent, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <p style={{ color: 'white', fontWeight: 700, margin: 0, fontSize: 14 }}>🔬 Skin Analysis</p>
        <span style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
          {urgent ? '⚠️ Urgent' : '✅ Low Risk'}
        </span>
      </div>
      <div style={{ backgroundColor: urgent ? '#FEF2F2' : '#F0FDF4', padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', backgroundColor: accent, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontSize: 16, fontWeight: 900 }}>{Math.round(data.confidence)}%</span>
            <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 9 }}>confidence</span>
          </div>
          <div>
            <p style={{ fontWeight: 700, fontSize: 15, color: '#000', margin: '0 0 4px' }}>{data.predicted_label}</p>
            <p style={{ fontSize: 11, color: '#9CA3AF', margin: 0 }}>Model accuracy: {(data.model_accuracy * 100).toFixed(1)}%</p>
          </div>
        </div>
        {data.all_predictions.map((pred, i) => {
          const hi = i === 0;
          const col = hi ? accent : '#9CA3AF';
          return (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: hi ? 700 : 400, color: hi ? '#000' : '#666' }}>{pred.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: col }}>{pred.probability}%</span>
              </div>
              <div style={{ backgroundColor: '#E5E5E5', borderRadius: 999, height: 5, overflow: 'hidden' }}>
                <div style={{ width: `${pred.probability}%`, height: '100%', backgroundColor: hi ? (urgent ? '#EF4444' : '#F97316') : '#D1D5DB', borderRadius: 999 }} />
              </div>
            </div>
          );
        })}
        {urgent && (
          <div style={{ marginTop: 12, backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '8px 12px' }}>
            <p style={{ fontSize: 11, color: '#EF4444', margin: 0, fontWeight: 600 }}>
              ⚠️ Possible serious skin condition — recommend prompt dermatology referral.
            </p>
          </div>
        )}
        <p style={{ fontSize: 11, color: '#9CA3AF', marginTop: 12, fontStyle: 'italic' }}>⚕️ {data.disclaimer}</p>
        <button onClick={onClear} style={clearBtn}>Clear result</button>
      </div>
    </div>
  );
};

/**
 * Consent-gated patient EHR panel, shared by the online ConsultationRoom and
 * the OfflineConsultationRoom. The doctor enters the patient's 6-digit consent
 * code, then browses Info / Allergies / Rx / X-Rays. X-rays can be analysed in
 * place — the AI result renders INSIDE this panel (never a side panel). The AI
 * tools shown are filtered by the doctor's specialty (`doctorDepartment`).
 *
 * Controlled visibility: the parent renders this only when open and keeps its
 * own toggle button; `onAccessChange` lets the parent reflect the green
 * "access granted" dot, `onClose` backs the ✕ button.
 */
const PatientEHRPanel = ({ patientUuid, onClose, onAccessChange, doctorDepartment = '', className = '' }) => {
  const availableModels = getAvailableModels(doctorDepartment);
  const [accessGranted, setAccessGranted] = useState(() => isEhrAccessValid(patientUuid));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [digits, setDigits] = useState(Array(6).fill(''));
  const [error, setError] = useState('');
  const [tab, setTab] = useState('info');
  const inputRefs = useRef([]);

  const [xrayResult, setXrayResult] = useState(null);
  const [xrayLoading, setXrayLoading] = useState(false);
  const [xrayImage, setXrayImage] = useState(null);

  // Full chest multi-label (14 conditions) — scoped to one image at a time.
  const [chestAnalysis, setChestAnalysis] = useState(null);
  const [analyzingChest, setAnalyzingChest] = useState(false);
  const [chestImage, setChestImage] = useState(null);

  // Brain MRI tumor detection — driven by a fresh file upload, not an EHR image.
  const [brainAnalysis, setBrainAnalysis] = useState(null);
  const [analyzingBrain, setAnalyzingBrain] = useState(false);

  // Skin disease detection — driven by a fresh file upload (dermatology only).
  const [skinAnalysis, setSkinAnalysis] = useState(null);
  const [analyzingSkin, setAnalyzingSkin] = useState(false);

  const loadData = async (patientId) => {
    try {
      const [ehrRes, imagesRes] = await Promise.all([
        API.get(`/api/doctor/patient-ehr/${patientId}/`),
        API.get(`/api/patient/ehr/images/?patient_id=${patientId}`),
      ]);
      const d = ehrRes.data?.data || {};
      const records = d.ehr_records || [];
      setData({
        basic: d.patient || null,
        allergies: d.allergies || [],
        prescriptions: records.filter((r) => r.record_type === 'prescription').slice(0, 5),
        images: imagesRes.data?.data?.images || [],
      });
    } catch (err) {
      console.error('EHR load error:', err);
      setData({ basic: null, allergies: [], prescriptions: [], images: [] });
    }
  };

  // Restore a still-valid EHR session on mount (e.g. after a tab switch) so the
  // doctor isn't re-prompted for the code within the 2-hour window.
  useEffect(() => {
    if (accessGranted && patientUuid) {
      onAccessChange?.(true);
      loadData(patientUuid);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientUuid]);

  const validateCode = async (code) => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await API.post('/api/doctor/validate-consent/', {
        token: code,
        patient_id: patientUuid,
      });
      if (res?.success) {
        grantEhrAccess(patientUuid);
        setAccessGranted(true);
        onAccessChange?.(true);
        await loadData(res.data?.patient_id || patientUuid);
      } else {
        setError(res?.message || 'Invalid code!');
        setDigits(Array(6).fill(''));
        inputRefs.current[0]?.focus();
      }
    } catch (err) {
      setError(err?.response?.data?.message || 'Invalid or expired code!');
      setDigits(Array(6).fill(''));
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleDigitInput = (value, index) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...digits];
    next[index] = value;
    setDigits(next);
    setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
    if (index === 5 && value) {
      const code = next.join('');
      if (code.length === 6) validateCode(code);
    }
  };

  // Fetch the EHR image as a blob and send to the AI endpoint — never downloaded.
  const analyzeXray = async (imageUrl) => {
    setXrayLoading(true);
    setXrayImage(imageUrl);
    setXrayResult(null);
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const fd = new FormData();
      fd.append('image', new File([blob], 'xray.jpg', { type: blob.type || 'image/jpeg' }));
      const { data: res } = await API.post('/api/ai/xray-predict/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res?.success) {
        setXrayResult(res.data);
        toast.success('X-Ray analyzed ✅');
      }
    } catch (err) {
      console.error(err);
      toast.error('X-Ray analysis failed!');
    } finally {
      setXrayLoading(false);
    }
  };

  // Full 14-condition chest screening — fetches the EHR image as a blob, same as
  // the quick pneumonia check, and renders the result inside this panel.
  const handleFullChestAnalysis = async (imageUrl) => {
    setAnalyzingChest(true);
    setChestImage(imageUrl);
    setChestAnalysis(null);
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const fd = new FormData();
      fd.append('image', new File([blob], 'xray.jpg', { type: blob.type || 'image/jpeg' }));
      const { data: res } = await API.post('/api/ai/chest-multilabel/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res?.success) {
        setChestAnalysis(res.data);
        toast.success('Chest analysis complete ✅');
      }
    } catch (err) {
      console.error(err);
      toast.error('Chest analysis failed!');
    } finally {
      setAnalyzingChest(false);
    }
  };

  // Brain MRI tumor detection from a directly uploaded image file.
  const handleBrainMRIAnalysis = async (imageFile) => {
    setAnalyzingBrain(true);
    setBrainAnalysis(null);
    try {
      const fd = new FormData();
      fd.append('image', imageFile);
      const { data: res } = await API.post('/api/ai/brain-tumor/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res?.success) {
        setBrainAnalysis(res.data);
        toast.success('Brain MRI analyzed ✅');
      }
    } catch (err) {
      console.error(err);
      toast.error('Brain MRI analysis failed!');
    } finally {
      setAnalyzingBrain(false);
    }
  };

  // Skin disease classification from a directly uploaded image file.
  const handleSkinAnalysis = async (imageFile) => {
    setAnalyzingSkin(true);
    setSkinAnalysis(null);
    try {
      const fd = new FormData();
      fd.append('image', imageFile);
      const { data: res } = await API.post('/api/ai/skin-disease/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res?.success) {
        setSkinAnalysis(res.data);
        toast.success('Skin photo analyzed ✅');
      }
    } catch (err) {
      console.error(err);
      toast.error('Skin analysis failed!');
    } finally {
      setAnalyzingSkin(false);
    }
  };

  const isXray = (t) =>
    typeof t === 'string' && (t.toLowerCase().includes('xray') || t.toLowerCase().includes('x-ray'));

  const age = (() => {
    const dob = data?.basic?.dob;
    if (!dob) return null;
    const d = new Date(dob);
    const now = new Date();
    let a = now.getFullYear() - d.getFullYear();
    if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a -= 1;
    return a;
  })();

  return (
    <div className={`border border-gray-200 rounded-2xl overflow-hidden bg-white ${className}`}>
      <div className="bg-orange-500 text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>🏥</span>
          <span className="font-semibold">Patient EHR</span>
          {accessGranted && (
            <span className="bg-success text-white text-xs px-2 py-0.5 rounded-full">
              Access Granted ✅
            </span>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-white/70 hover:text-white text-lg leading-none">
            ✕
          </button>
        )}
      </div>

      {!accessGranted ? (
        <div className="p-4">
          <p className="text-sm text-gray-600 text-center mb-4">
            Ask the patient for their 6-digit EHR code
          </p>
          <div className="flex justify-center gap-2 mb-3">
            {digits.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleDigitInput(e.target.value, i)}
                onKeyDown={(e) => {
                  if (e.key === 'Backspace' && !digit && i > 0) inputRefs.current[i - 1]?.focus();
                }}
                className={`w-10 h-12 text-center text-xl font-bold border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-300 ${
                  error
                    ? 'border-danger'
                    : digit
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-gray-300'
                }`}
              />
            ))}
          </div>
          {error && <p className="text-danger text-xs text-center mb-2">❌ {error}</p>}
          {loading && <p className="text-primary-500 text-xs text-center">Verifying code…</p>}
          <p className="text-xs text-gray-400 text-center mt-2">
            Code auto-submits when all 6 digits are entered
          </p>
        </div>
      ) : (
        <div className="p-4 max-h-[34rem] overflow-y-auto">
          <div className="flex gap-1 mb-4 bg-gray-100 rounded-xl p-1">
            {[
              { id: 'info', label: '👤 Info' },
              { id: 'allergies', label: '⚠️ Allergies' },
              { id: 'prescriptions', label: '💊 Prescriptions' },
              { id: 'images', label: '🫁 X-Rays' },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                  tab === t.id ? 'bg-white shadow-sm text-primary-600' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Info */}
          {tab === 'info' &&
            (data?.basic ? (
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">Blood Group</p>
                    <p className="font-bold text-danger text-lg">{data.basic.blood_group || '—'}</p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">Age</p>
                    <p className="font-bold text-lg">{age != null ? `${age} yrs` : '—'}</p>
                  </div>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">Name</p>
                  <p className="font-medium">{data.basic.full_name}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">Emergency Contact</p>
                  <p className="font-medium">📞 {data.basic.emergency_contact || '—'}</p>
                </div>
                {data.basic.lifestyle_data && Object.keys(data.basic.lifestyle_data).length > 0 && (
                  <div className="bg-primary-50 rounded-xl p-3">
                    <p className="text-xs text-primary-600 font-medium mb-1">Lifestyle</p>
                    <p className="text-xs text-gray-600 break-words">
                      {JSON.stringify(data.basic.lifestyle_data)}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-gray-400 py-4 text-sm">No profile data</p>
            ))}

          {/* Allergies */}
          {tab === 'allergies' && (
            <div>
              {(data?.allergies?.length || 0) === 0 ? (
                <p className="text-center text-gray-400 py-4 text-sm">No known allergies ✅</p>
              ) : (
                data.allergies.map((allergy, i) => (
                  <div key={i} className="bg-red-50 border border-red-200 rounded-xl p-3 mb-2">
                    <p className="font-semibold text-red-700">⚠️ {allergy.allergen}</p>
                    {allergy.reaction && <p className="text-xs text-red-600">Reaction: {allergy.reaction}</p>}
                    {allergy.severity && <p className="text-xs text-red-500">Severity: {allergy.severity}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Prescriptions */}
          {tab === 'prescriptions' && (
            <div>
              {(data?.prescriptions?.length || 0) === 0 ? (
                <p className="text-center text-gray-400 py-4 text-sm">No prescriptions yet</p>
              ) : (
                data.prescriptions.map((rx, i) => (
                  <div key={i} className="bg-gray-50 rounded-xl p-3 mb-2 border border-gray-200">
                    <p className="text-xs text-gray-500">{rx.recorded_at?.slice(0, 10)}</p>
                    <p className="font-medium text-sm">{rx.title || 'Prescription'}</p>
                    {rx.content && <p className="text-xs text-gray-500 mt-1 truncate">{rx.content}</p>}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Medical images / X-Rays */}
          {tab === 'images' && (
            <div>
              {/* Department-scoped AI tools note */}
              <p className="text-[11px] text-gray-400 text-center mb-3">
                🤖 AI tools shown for{' '}
                <span className="font-semibold text-gray-500">{doctorDepartment || 'General'}</span>
              </p>

              {/* Brain MRI upload + result — neuro / general only */}
              {availableModels.includes('brain_mri') && (
                <div className="mb-4 border border-gray-100 rounded-xl p-3">
                  <p className="text-sm font-bold text-black mb-3">🧠 Brain MRI Analysis</p>
                  <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-orange-400 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={analyzingBrain}
                      onChange={(e) => {
                        if (e.target.files[0]) handleBrainMRIAnalysis(e.target.files[0]);
                      }}
                    />
                    <p className="text-2xl mb-1">🧠</p>
                    <p className="text-xs text-gray-500">
                      {analyzingBrain ? '⏳ Analyzing MRI…' : 'Upload & Analyze Brain MRI'}
                    </p>
                  </label>

                  {brainAnalysis && (
                    <BrainResultCard data={brainAnalysis} onClear={() => setBrainAnalysis(null)} />
                  )}
                </div>
              )}

              {/* Skin disease upload + result — dermatology only */}
              {availableModels.includes('skin_disease') && (
                <div className="mb-4 border border-gray-100 rounded-xl p-3">
                  <p className="text-sm font-bold text-black mb-3">🔬 Skin Disease Analysis</p>
                  <label className="block w-full border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-orange-400 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={analyzingSkin}
                      onChange={(e) => {
                        if (e.target.files[0]) handleSkinAnalysis(e.target.files[0]);
                      }}
                    />
                    <p className="text-2xl mb-1">🔬</p>
                    <p className="text-xs text-gray-500">
                      {analyzingSkin ? '⏳ Analyzing skin photo…' : 'Upload & Analyze Skin Photo'}
                    </p>
                  </label>

                  {skinAnalysis && (
                    <SkinResultCard data={skinAnalysis} onClear={() => setSkinAnalysis(null)} />
                  )}
                </div>
              )}

              {/* Lab Reports — auto-saved from completed lab tests (view-only) */}
              {(data?.images || []).some((i) => i.image_type === 'lab_report') && (
                <div className="mb-4">
                  <h4 className="text-[13px] font-bold text-black mb-2 flex items-center gap-1.5">
                    📊 Lab Reports
                    <span className="text-white text-[10px] px-1.5 rounded-full" style={{ backgroundColor: '#F97316' }}>
                      {data.images.filter((i) => i.image_type === 'lab_report').length}
                    </span>
                  </h4>
                  <div className="flex flex-col gap-2">
                    {data.images.filter((i) => i.image_type === 'lab_report').map((rep, i) => (
                      <div key={i} className="flex items-center justify-between rounded-[10px] border border-gray-200 px-3 py-2.5" style={{ backgroundColor: '#F9FAFB' }}>
                        <div className="min-w-0">
                          <p className="font-semibold text-[13px] text-black m-0 truncate">{rep.description || rep.title || 'Lab Report'}</p>
                          <p className="text-[11px] text-gray-400 m-0">
                            📅 {rep.uploaded_at ? new Date(rep.uploaded_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                          </p>
                        </div>
                        <a href={rep.image_url} target="_blank" rel="noreferrer" className="shrink-0 px-3.5 py-1.5 rounded-lg text-white text-[12px] font-semibold no-underline" style={{ backgroundColor: '#F97316' }}>
                          View →
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(data?.images?.length || 0) === 0 ? (
                <div className="text-center py-6">
                  <span className="text-4xl">🫁</span>
                  <p className="text-gray-400 text-sm mt-2">No medical images uploaded</p>
                  <p className="text-gray-400 text-xs mt-1">
                    Ask the patient to upload an X-Ray to their EHR Wallet
                  </p>
                </div>
              ) : (
                data.images.filter((img) => img.image_type !== 'lab_report').map((img, i) => (
                  <div key={i} className="border border-gray-200 rounded-xl mb-3 overflow-hidden">
                    <div className="relative">
                      <img src={img.image_url} alt={img.title} className="w-full h-64 object-contain bg-black" />
                      <span className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-full">
                        {img.image_type}
                      </span>
                    </div>
                    <div className="p-3">
                      <p className="font-medium text-sm">{img.title}</p>
                      <p className="text-xs text-gray-500">
                        📅 {img.scan_date?.slice(0, 10) || img.uploaded_at?.slice(0, 10)}
                      </p>
                      {img.hospital_name && <p className="text-xs text-gray-500">🏥 {img.hospital_name}</p>}
                      {isXray(img.image_type) ? (
                        <>
                          <div className="flex gap-2 mt-2">
                            {availableModels.includes('pneumonia') && (
                              <button
                                onClick={() => analyzeXray(img.image_url)}
                                disabled={xrayLoading}
                                className="flex-1 py-2 rounded-xl text-xs font-semibold bg-black text-white disabled:opacity-50"
                              >
                                {xrayLoading && xrayImage === img.image_url ? '⏳ Analyzing…' : '🫁 Pneumonia Check'}
                              </button>
                            )}
                            {availableModels.includes('chest_multilabel') && (
                              <button
                                onClick={() => handleFullChestAnalysis(img.image_url)}
                                disabled={analyzingChest}
                                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                                style={{ backgroundColor: '#F97316' }}
                              >
                                {analyzingChest && chestImage === img.image_url ? '⏳ Analyzing…' : '📊 Full Analysis'}
                              </button>
                            )}
                          </div>
                          {!availableModels.includes('pneumonia') && !availableModels.includes('chest_multilabel') && (
                            <p className="text-xs text-gray-400 mt-2">Chest AI tools aren't enabled for your specialty.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-gray-400 mt-2">{img.image_type} — view only</p>
                      )}

                      {/* Results rendered INSIDE the panel */}
                      {xrayResult && xrayImage === img.image_url && (
                        <PneumoniaResultCard
                          data={xrayResult}
                          onClear={() => { setXrayResult(null); setXrayImage(null); }}
                        />
                      )}
                      {chestAnalysis && chestImage === img.image_url && (
                        <ChestResultCard
                          data={chestAnalysis}
                          onClear={() => { setChestAnalysis(null); setChestImage(null); }}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PatientEHRPanel;
