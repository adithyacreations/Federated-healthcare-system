import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FiSave, FiCpu, FiPlus, FiX, FiFilePlus, FiClipboard, FiUser,
  FiAlertOctagon, FiImage, FiCheckCircle,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import FormInput from '../../components/auth/FormInput';
import PatientEHRPanel from '../../components/consultation/PatientEHRPanel';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import { openPrescriptionPdf } from '../../utils/pdf';

const FREQUENCIES = [
  { value: 'once', label: 'Once daily' },
  { value: 'twice', label: 'Twice daily' },
  { value: 'thrice', label: 'Thrice daily' },
  { value: 'as_needed', label: 'As needed' },
];

/**
 * Physical-visit consultation room. Identical clinical tooling to the online
 * ConsultationRoom — AI diagnosis, X-ray, EHR, prescriptions, lab orders — but
 * with no Jitsi video call, for a patient who is present in person.
 */
const OfflineConsultationRoom = () => {
  const { consultation_id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const consultations = useApi('/api/doctor/consultations/');
  const symptoms = useApi('/api/ai/symptoms-list/');

  const consultation = useMemo(
    () => (consultations.data || []).find((c) => c.consultation_id === consultation_id),
    [consultations.data, consultation_id]
  );

  // Notes & diagnosis
  const [notes, setNotes] = useState('');
  const [finalDx, setFinalDx] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (consultation) {
      setNotes(consultation.doctor_notes || '');
      setFinalDx(consultation.final_diagnosis || '');
    }
  }, [consultation]);

  // AI clinical diagnosis
  const [aiSyms, setAiSyms] = useState([]);
  const [aiSearch, setAiSearch] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // FL maintenance — disables AI buttons while a fresh model is being trained.
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

  // Prescription writer
  const [med, setMed] = useState({ name: '', dosage: '', frequency: 'once', days: '' });
  const [medicines, setMedicines] = useState([]);
  const [instructions, setInstructions] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [generatingRx, setGeneratingRx] = useState(false);
  const [rxId, setRxId] = useState(null);

  // Chest X-Ray AI analysis (manual upload — result stays on left panel)
  const [xrayFile, setXrayFile] = useState(null);
  const [xrayPreview, setXrayPreview] = useState(null);
  const [xrayBusy, setXrayBusy] = useState(false);
  const [xrayResult, setXrayResult] = useState(null);

  // Lab orders
  const [labTest, setLabTest] = useState('');
  const [labTests, setLabTests] = useState([]);
  const [labPriority, setLabPriority] = useState('normal');
  const [labNotes, setLabNotes] = useState('');
  const [orderingLab, setOrderingLab] = useState(false);

  // EHR panel
  const [showEHRPanel, setShowEHRPanel] = useState(false);
  const [ehrAccessGranted, setEHRAccessGranted] = useState(false);

  if (consultations.loading) {
    return <DashboardLayout><div className="card">Loading consultation…</div></DashboardLayout>;
  }
  if (!consultation) {
    return (
      <DashboardLayout>
        <div className="card text-center py-8">
          <FiAlertOctagon className="w-10 h-10 mx-auto text-warning mb-2" />
          <div className="font-semibold text-primary-500">Consultation not found</div>
          <p className="text-sm text-gray-500 mt-1">It may have been completed or doesn't belong to you.</p>
          <Link to="/doctor/consultations" className="btn-secondary mt-4 inline-block">Back to Consultations</Link>
        </div>
      </DashboardLayout>
    );
  }

  // ─── Save notes / complete ──────────────────────────────────
  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      await API.put(`/api/doctor/consultations/${consultation_id}/`, {
        doctor_notes: notes,
        final_diagnosis: finalDx,
      });
      toast.success('Notes saved ✅');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSavingNotes(false);
    }
  };

  const completeVisit = async () => {
    if (!window.confirm('Complete this physical visit?')) return;
    setCompleting(true);
    try {
      await API.put(`/api/doctor/consultations/${consultation_id}/`, {
        doctor_notes: notes,
        final_diagnosis: finalDx,
        status: 'completed',
      });
      toast.success('Consultation completed ✅');
      navigate('/doctor/consultations');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not complete visit');
    } finally {
      setCompleting(false);
    }
  };

  // ─── AI clinical diagnosis ──────────────────────────────────
  const symList = symptoms.data?.symptoms || [];
  const filteredSyms = symList.filter((s) =>
    s.toLowerCase().includes(aiSearch.trim().toLowerCase())
  );

  const toggleAiSym = (s) => {
    setAiSyms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].slice(0, 15)));
  };

  const runAI = async () => {
    if (aiSyms.length === 0) return toast.error('Pick at least one symptom');
    if (!consultation.patient_uuid) return toast.error('Patient ID missing');
    setAiBusy(true);
    setAiResult(null);
    try {
      const { data } = await API.post('/api/ai/clinical-diagnosis/', {
        symptoms: aiSyms,
        patient_id: consultation.patient_uuid,
        consultation_id,
      });
      setAiResult(data?.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'AI diagnosis failed');
    } finally {
      setAiBusy(false);
    }
  };

  // ─── Prescription writer ────────────────────────────────────
  const addMedicine = () => {
    if (!med.name.trim()) return toast.error('Medicine name required');
    setMedicines([...medicines, { ...med }]);
    setMed({ name: '', dosage: '', frequency: 'once', days: '' });
  };
  const removeMedicine = (i) => setMedicines(medicines.filter((_, idx) => idx !== i));

  const generatePrescription = async () => {
    if (medicines.length === 0) return toast.error('Add at least one medicine');
    setGeneratingRx(true);
    setRxId(null);
    try {
      const { data } = await API.post('/api/doctor/prescriptions/create/', {
        consultation_id,
        medicines,
        diagnosis: finalDx,
        instructions,
        valid_until: validUntil || null,
      });
      setRxId((data?.data || {}).prescription_id);
      toast.success('Prescription created');
      setMedicines([]);
      setInstructions('');
      setValidUntil('');
    } catch (err) {
      const d = err?.response?.data;
      const msg = d?.errors ? Object.values(d.errors).flat().join(' · ') : d?.message || 'Could not create prescription';
      toast.error(msg);
    } finally {
      setGeneratingRx(false);
    }
  };

  // ─── Chest X-Ray AI analysis ────────────────────────────────
  const onXrayPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setXrayFile(file);
    setXrayResult(null);
    setXrayPreview(URL.createObjectURL(file));
  };

  const runXray = async () => {
    if (!xrayFile) return toast.error('Select a chest X-ray image');
    setXrayBusy(true);
    setXrayResult(null);
    try {
      const fd = new FormData();
      fd.append('image', xrayFile);
      const { data } = await API.post('/api/ai/xray-predict/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setXrayResult(data?.data);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'X-ray analysis failed');
    } finally {
      setXrayBusy(false);
    }
  };

  // ─── Lab orders ─────────────────────────────────────────────
  const addLab = () => {
    if (!labTest.trim()) return;
    setLabTests([...labTests, labTest.trim()]);
    setLabTest('');
  };
  const removeLab = (i) => setLabTests(labTests.filter((_, idx) => idx !== i));

  const orderLab = async () => {
    if (labTests.length === 0) return toast.error('Add at least one test');
    setOrderingLab(true);
    try {
      await API.post('/api/doctor/lab-orders/create/', {
        patient_id: consultation.patient_uuid,
        tests_ordered: labTests,
        priority: labPriority,
        notes: labNotes,
      });
      toast.success('Lab tests ordered');
      setLabTests([]); setLabNotes(''); setLabPriority('normal');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Lab order failed');
    } finally {
      setOrderingLab(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <DashboardLayout>
      {/* Physical-visit header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <div className="bg-success/10 text-success px-4 py-2 rounded-xl font-semibold flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-success rounded-full animate-pulse" />
            🏥 Physical Visit
          </div>
          <div>
            <h1 className="font-bold text-lg text-primary-500">
              {consultation.patient_name || 'Patient Consultation'}
            </h1>
            <div className="text-xs text-gray-500 flex items-center gap-2">
              {consultation.started_at && (
                <span>Started: {consultation.started_at.slice(0, 16).replace('T', ' ')}</span>
              )}
              <Badge status={consultation.status} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEHRPanel((v) => !v)}
            className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition-all ${
              showEHRPanel ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            🏥 EHR Access
            {ehrAccessGranted && <span className="w-2 h-2 bg-success rounded-full" />}
          </button>
          <button
            onClick={completeVisit}
            disabled={completing}
            className="inline-flex items-center gap-2 bg-success text-white px-5 py-2 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50"
          >
            <FiCheckCircle className="w-4 h-4" />
            {completing ? 'Completing…' : 'Complete Visit'}
          </button>
        </div>
      </div>

      {showEHRPanel && (
        <PatientEHRPanel
          patientUuid={consultation.patient_uuid}
          onClose={() => setShowEHRPanel(false)}
          onAccessChange={setEHRAccessGranted}
          doctorDepartment={user?.specialization || ''}
          className="mb-6 max-w-4xl"
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ─── LEFT PANEL ──────────────────────────────────────── */}
        <aside className="space-y-5">
          {/* Patient quick info */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FiUser className="text-primary-500" />
              <h3 className="font-semibold text-primary-500">Patient Information</h3>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">Blood Group</p>
                <p className="font-bold text-danger text-xl">{consultation.blood_group || 'N/A'}</p>
              </div>
              <div className="bg-primary-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">Age</p>
                <p className="font-bold text-xl">{consultation.patient_age ?? 'N/A'}</p>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-500">Gender</p>
                <p className="font-bold capitalize">{consultation.gender || 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* AI Diagnosis */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FiCpu className="text-accent" />
              <h3 className="font-semibold text-primary-500">AI Diagnosis Tool</h3>
            </div>
            <input
              type="text"
              placeholder="Search symptoms…"
              value={aiSearch}
              onChange={(e) => setAiSearch(e.target.value)}
              className="input-field mb-3"
            />
            <div className="flex flex-wrap gap-1.5 mb-3 max-h-32 overflow-y-auto border border-gray-100 rounded-xl p-2">
              {filteredSyms.slice(0, 60).map((s) => (
                <button
                  key={s}
                  onClick={() => toggleAiSym(s)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition ${
                    aiSyms.includes(s)
                      ? 'bg-orange-500 text-white border-primary-500'
                      : 'border-gray-200 text-gray-600 hover:border-primary-300'
                  }`}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
            {aiSyms.length > 0 && <div className="text-xs text-gray-500 mb-2">{aiSyms.length} selected</div>}
            {flMaintenance && (
              <div
                className="rounded-2xl p-3 mb-3 border-2 flex items-center gap-3"
                style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}
              >
                <span className="text-xl">🔧</span>
                <div>
                  <p className="font-bold text-sm" style={{ color: '#F97316' }}>
                    AI Services Under Maintenance
                  </p>
                  <p className="text-xs text-gray-500">
                    FL model is being retrained. AI diagnosis is temporarily unavailable.
                  </p>
                </div>
              </div>
            )}
            <button onClick={runAI} disabled={aiBusy || flMaintenance} className="btn-orange w-full disabled:opacity-60">
              {flMaintenance ? '🔧 Under Maintenance' : aiBusy ? 'Analyzing…' : 'Get AI Suggestions'}
            </button>

            {aiResult && (
              <div className="mt-4 space-y-2 text-sm">
                <div className="text-xs uppercase text-gray-500">Top Diagnoses</div>
                {aiResult.top_diagnoses?.map((d, i) => (
                  <div key={i}>
                    <div className="flex justify-between">
                      <span>{d.disease}</span>
                      <span className="font-semibold text-primary-500">{d.confidence}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-primary-400 to-accent"
                        style={{ width: `${Math.min(d.confidence, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {aiResult.recommended_tests?.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs uppercase text-gray-500 mb-1">Recommended Tests</div>
                    <div className="flex flex-wrap gap-1">
                      {aiResult.recommended_tests.slice(0, 8).map((t, i) => (
                        <span key={i} className="badge-info">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                {aiResult.risk_flags?.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs uppercase text-gray-500 mb-1">Risk Flags</div>
                    <ul className="text-xs space-y-0.5 text-danger">
                      {aiResult.risk_flags.map((f, i) => (
                        <li key={i}>⚠️ {f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chest X-Ray AI */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FiImage className="text-accent" />
              <h3 className="font-semibold text-primary-500">Chest X-Ray AI</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Upload a chest X-ray image for AI-assisted pneumonia screening (MobileNetV2).
            </p>

            <label className="block cursor-pointer">
              <span className="btn-secondary w-full inline-flex items-center justify-center gap-2">
                <FiImage className="w-4 h-4" />
                {xrayFile ? 'Change Image' : 'Select X-Ray Image'}
              </span>
              <input type="file" accept="image/*" onChange={onXrayPick} className="hidden" />
            </label>

            {xrayPreview && (
              <img src={xrayPreview} alt="X-ray preview" className="mt-3 w-full h-40 object-contain bg-black rounded-xl" />
            )}

            {xrayFile && (
              <button onClick={runXray} disabled={xrayBusy || flMaintenance} className="btn-orange w-full mt-3 disabled:opacity-60">
                {flMaintenance ? '🔧 Under Maintenance' : xrayBusy ? 'Analyzing X-Ray…' : 'Analyze X-Ray'}
              </button>
            )}

            {xrayResult && (
              <div className="mt-4 space-y-3 text-sm">
                <div
                  className={`rounded-xl px-4 py-3 text-center ${
                    xrayResult.predicted_class === 'PNEUMONIA'
                      ? 'bg-danger/10 border border-danger/30'
                      : 'bg-success/10 border border-success/30'
                  }`}
                >
                  <div
                    className={`text-lg font-bold ${
                      xrayResult.predicted_class === 'PNEUMONIA' ? 'text-danger' : 'text-success'
                    }`}
                  >
                    {xrayResult.predicted_class}
                  </div>
                  <div className="text-xs text-gray-500">
                    {xrayResult.confidence}% confidence · Severity {xrayResult.severity}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span>Normal</span>
                    <span className="font-semibold">{xrayResult.normal_probability}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-success" style={{ width: `${xrayResult.normal_probability}%` }} />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span>Pneumonia</span>
                    <span className="font-semibold">{xrayResult.pneumonia_probability}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-danger" style={{ width: `${xrayResult.pneumonia_probability}%` }} />
                  </div>
                </div>

                {xrayResult.recommendations?.length > 0 && (
                  <div>
                    <div className="text-xs uppercase text-gray-500 mb-1">Recommendations</div>
                    <ul className="text-xs space-y-0.5 text-gray-700">
                      {xrayResult.recommendations.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[11px] text-gray-400 italic border-t border-gray-100 pt-2">
                  {xrayResult.disclaimer}
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* ─── RIGHT PANEL ─────────────────────────────────────── */}
        <main className="space-y-5">
          {/* Notes */}
          <div className="card">
            <h3 className="font-semibold text-primary-500 mb-3">Consultation Notes</h3>
            <FormInput label="Doctor Notes" as="textarea" rows={4}
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, history…" />
            <div className="mt-4">
              <FormInput label="Final Diagnosis"
                value={finalDx} onChange={(e) => setFinalDx(e.target.value)} placeholder="Primary diagnosis" />
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={saveNotes} disabled={savingNotes} className="btn-secondary inline-flex items-center gap-2 disabled:opacity-60">
                <FiSave className="w-4 h-4" /> Save Notes
              </button>
            </div>
          </div>

          {/* Prescription writer */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FiFilePlus className="text-primary-500" />
              <h3 className="font-semibold text-primary-500">Prescription Writer</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <FormInput label="Medicine" placeholder="e.g. Paracetamol 500mg"
                value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })} />
              <FormInput label="Dosage" placeholder="500 mg"
                value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })} />
              <FormInput label="Frequency" as="select" value={med.frequency}
                onChange={(e) => setMed({ ...med, frequency: e.target.value })} options={FREQUENCIES} />
              <FormInput label="Days" type="number" placeholder="5"
                value={med.days} onChange={(e) => setMed({ ...med, days: e.target.value })} />
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={addMedicine} className="btn-secondary inline-flex items-center gap-2">
                <FiPlus className="w-4 h-4" /> Add Medicine
              </button>
            </div>

            {medicines.length > 0 && (
              <div className="mt-4 space-y-2">
                {medicines.map((m, i) => (
                  <div key={i} className="flex items-center justify-between bg-primary-50 rounded-xl px-4 py-2 text-sm">
                    <div className="min-w-0">
                      <span className="font-medium text-primary-500">{m.name}</span>
                      <span className="text-gray-500 ml-2">
                        {m.dosage && `${m.dosage} · `}
                        {FREQUENCIES.find((f) => f.value === m.frequency)?.label}
                        {m.days && ` · ${m.days} days`}
                      </span>
                    </div>
                    <button onClick={() => removeMedicine(i)} className="text-gray-400 hover:text-danger">
                      <FiX />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <FormInput label="Instructions" as="textarea" rows={2}
                value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Take after meals…" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <FormInput label="Valid Until (optional)" type="date"
                value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              <div className="flex items-end justify-end">
                <button onClick={generatePrescription} disabled={generatingRx || medicines.length === 0}
                  className="btn-orange disabled:opacity-60 w-full sm:w-auto">
                  {generatingRx ? 'Generating PDF…' : 'Generate Prescription PDF'}
                </button>
              </div>
            </div>

            {rxId && (
              <div className="mt-4 bg-success/10 border border-success/30 rounded-xl px-4 py-3 text-sm flex items-center justify-between">
                <span className="text-success font-medium">Prescription created</span>
                <button onClick={() => openPrescriptionPdf(rxId)} className="text-primary-500 hover:underline font-medium">
                  Download PDF
                </button>
              </div>
            )}
          </div>

          {/* Lab orders */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <FiClipboard className="text-primary-500" />
              <h3 className="font-semibold text-primary-500">Order Lab Tests</h3>
            </div>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                placeholder="e.g. CBC"
                value={labTest}
                onChange={(e) => setLabTest(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLab())}
                className="input-field flex-1"
              />
              <button onClick={addLab} className="btn-secondary">Add</button>
            </div>
            {labTests.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {labTests.map((t, i) => (
                  <span key={i} className="inline-flex items-center gap-1 bg-primary-50 text-primary-600 px-3 py-1 rounded-full text-sm">
                    {t}
                    <button onClick={() => removeLab(i)} className="hover:text-danger">
                      <FiX className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormInput label="Priority" as="select" value={labPriority}
                onChange={(e) => setLabPriority(e.target.value)}
                options={[
                  { value: 'normal', label: 'Normal' },
                  { value: 'urgent', label: 'Urgent' },
                  { value: 'stat', label: 'STAT' },
                ]} />
              <FormInput label="Notes" value={labNotes} onChange={(e) => setLabNotes(e.target.value)} />
            </div>
            <div className="flex justify-end mt-3">
              <button onClick={orderLab} disabled={orderingLab || labTests.length === 0} className="btn-orange disabled:opacity-60">
                {orderingLab ? 'Ordering…' : 'Order Tests'}
              </button>
            </div>
          </div>
        </main>
      </div>
    </DashboardLayout>
  );
};

export default OfflineConsultationRoom;
