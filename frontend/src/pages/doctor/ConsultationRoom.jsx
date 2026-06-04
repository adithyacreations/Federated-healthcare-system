import { useState, useMemo, useEffect, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FiVideo, FiSave, FiCpu, FiPlus, FiX, FiFilePlus, FiClipboard, FiUser,
  FiAlertOctagon, FiArrowLeft,
} from 'react-icons/fi';

import Badge from '../../components/common/Badge';
import FormInput from '../../components/auth/FormInput';
import ConsultationChat from '../../components/consultation/ConsultationChat';
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

const TABS = [
  { id: 'ehr', label: '📋 EHR' },
  { id: 'chat', label: '💬 Chat' },
  { id: 'ai', label: '🤖 AI' },
  { id: 'lab', label: '🔬 Lab' },
  { id: 'rx', label: '💊 Prescriptions' },
  { id: 'notes', label: '📝 Notes' },
];

/**
 * Isolated, memoized Jitsi iframe. Because it only depends on `roomId`,
 * React keeps the same iframe DOM node across parent re-renders — the AI
 * diagnosis / prescription tools update state without ever remounting the call.
 */
const JitsiFrame = memo(({ roomId }) => (
  <iframe
    title="Jitsi Meet"
    src={`https://meet.jit.si/${roomId}`}
    allow="camera; microphone; fullscreen; display-capture; autoplay"
    style={{ width: '100%', height: '100%', border: 'none' }}
  />
));

const ConsultationRoom = () => {
  const { consultation_id } = useParams();
  const { user } = useAuth();
  const consultations = useApi('/api/doctor/consultations/');
  const symptoms = useApi('/api/ai/symptoms-list/');

  const consultation = useMemo(
    () => (consultations.data || []).find((c) => c.consultation_id === consultation_id),
    [consultations.data, consultation_id]
  );

  // Patient EHR (requires QR consent — best-effort)
  const ehrUrl = consultation?.patient_id ? `/api/doctor/patient-ehr/${consultation.patient_uuid}/` : null;
  const ehr = useApi(ehrUrl, { enabled: Boolean(ehrUrl) });

  // Active right-panel tab
  const [activeTab, setActiveTab] = useState('ehr');

  // Notes & diagnosis
  const [notes, setNotes] = useState('');
  const [finalDx, setFinalDx] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

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

  // Patient EHR panel access flag (consent-gated; PatientEHRPanel owns its state)
  const [ehrAccessGranted, setEHRAccessGranted] = useState(false);

  // Lab orders
  const [labTest, setLabTest] = useState('');
  const [labTests, setLabTests] = useState([]);
  const [labPriority, setLabPriority] = useState('normal');
  const [labNotes, setLabNotes] = useState('');
  const [orderingLab, setOrderingLab] = useState(false);

  if (consultations.loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-ink text-white/70 text-sm">
        Loading consultation…
      </div>
    );
  }
  if (!consultation) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-ink text-white gap-3">
        <FiAlertOctagon className="w-10 h-10 text-warning" />
        <div className="font-semibold">Consultation not found</div>
        <p className="text-sm text-white/60">It may have been completed or doesn't belong to you.</p>
        <Link to="/doctor/consultations" className="btn-orange mt-2">Back to Consultations</Link>
      </div>
    );
  }

  // ─── Save notes / final diagnosis ───────────────────────────
  const saveNotes = async (markCompleted = false) => {
    setSavingNotes(true);
    try {
      const body = { doctor_notes: notes, final_diagnosis: finalDx };
      if (markCompleted) body.status = 'completed';
      await API.put(`/api/doctor/consultations/${consultation_id}/`, body);
      toast.success(markCompleted ? 'Consultation completed ✅' : 'Notes saved ✅');
      // No refetch — keeps local state and never remounts the Jitsi call.
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Save failed');
    } finally {
      setSavingNotes(false);
    }
  };

  // ─── AI clinical diagnosis ──────────────────────────────────
  const symList = symptoms.data?.symptoms || [];
  const filteredSyms = symList.filter((s) =>
    s.toLowerCase().includes(aiSearch.trim().toLowerCase())
  );

  const toggleAiSym = (s) => {
    setAiSyms((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s].slice(0, 15));
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
      const result = data?.data || {};
      setRxId(result.prescription_id);
      toast.success('Prescription created');
      setMedicines([]);
      setInstructions('');
      setValidUntil('');
    } catch (err) {
      const data = err?.response?.data;
      const msg = data?.errors
        ? Object.values(data.errors).flat().join(' · ')
        : data?.message || 'Could not create prescription';
      toast.error(msg);
    } finally {
      setGeneratingRx(false);
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

  // ─── EHR derived data ───────────────────────────────────────
  const patient = ehr.data?.patient;
  const allergies = ehr.data?.allergies || [];
  const ehrRecords = ehr.data?.ehr_records || [];
  const recentDx = ehrRecords.filter((r) => r.record_type === 'diagnosis').slice(0, 3);
  const activeRx = ehrRecords.filter((r) => r.record_type === 'prescription').slice(0, 3);
  const noConsent = ehr.error?.response?.status === 403;

  const patientInitial = (consultation.patient_name || 'P').charAt(0).toUpperCase();

  // ─── Render — full-screen focus layout ──────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#111111', overflow: 'hidden' }}>
      {/* ─── Video (65%) ─────────────────────────────────────── */}
      <div style={{ flex: '0 0 65%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <div style={{ flex: 1, backgroundColor: '#000' }}>
          {consultation.jitsi_room_id ? (
            <JitsiFrame roomId={consultation.jitsi_room_id} />
          ) : (
            <div className="h-full flex items-center justify-center text-white/60 text-sm">
              No Jitsi room created yet.
            </div>
          )}
        </div>

        {/* Bottom info bar */}
        <div style={{ height: 60, backgroundColor: '#1A1A1A', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16 }}>
          <Link
            to="/doctor/consultations"
            className="inline-flex items-center gap-1.5 text-white/80 hover:text-white text-sm"
          >
            <FiArrowLeft className="w-4 h-4" /> Back
          </Link>
          <span style={{ color: 'white', fontWeight: 600 }} className="truncate">
            Consultation with {consultation.patient_name}
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: '#F97316', fontSize: 13 }}>
            <FiVideo className="w-4 h-4" /> 🔴 Live
          </span>
          <span style={{ marginLeft: 'auto' }}><Badge status={consultation.status} /></span>
        </div>
      </div>

      {/* ─── Right panel (35%) ───────────────────────────────── */}
      <div style={{ flex: '0 0 35%', backgroundColor: '#FAF7F2', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ backgroundColor: 'white', padding: '14px 16px', borderBottom: '1px solid #E5E5E5', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#F97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, flexShrink: 0 }}>
            {patientInitial}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }} className="truncate">{consultation.patient_name}</p>
            <p style={{ margin: 0, color: '#666', fontSize: 12 }}>
              Patient{ehrAccessGranted ? ' · EHR unlocked ✅' : ''}
            </p>
          </div>
          <span className="ml-auto text-xs text-gray-400">{consultation.slot_date} · {consultation.slot_time}</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', backgroundColor: 'white', borderBottom: '1px solid #E5E5E5' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                flex: 1, padding: '12px 4px', border: 'none', cursor: 'pointer', fontSize: 11,
                backgroundColor: activeTab === t.id ? '#FFF7ED' : 'white',
                color: activeTab === t.id ? '#F97316' : '#666',
                fontWeight: activeTab === t.id ? 700 : 500,
                borderBottom: activeTab === t.id ? '2px solid #F97316' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {/* ─── EHR ───────────────────────────────────── */}
          {activeTab === 'ehr' && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <FiUser className="text-primary-500" />
                  <h3 className="font-semibold text-primary-500">Patient Info</h3>
                </div>
                {ehr.loading ? (
                  <p className="text-sm text-gray-500">Loading EHR…</p>
                ) : noConsent ? (
                  <div className="text-sm text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-xl p-3">
                    EHR locked — enter the patient's 6-digit consent code below.
                  </div>
                ) : patient ? (
                  <div className="space-y-1.5 text-sm">
                    <div><span className="text-gray-500">Name:</span> {patient.full_name}</div>
                    <div><span className="text-gray-500">DOB:</span> {patient.dob}</div>
                    <div><span className="text-gray-500">Gender:</span> {patient.gender || '—'}</div>
                    <div><span className="text-gray-500">Blood Group:</span> {patient.blood_group || '—'}</div>
                    <div><span className="text-gray-500">BMI:</span> {patient.bmi || '—'}</div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">{consultation.patient_name}</p>
                )}
              </div>

              {!noConsent && allergies.length > 0 && (
                <div className="card">
                  <h3 className="font-semibold text-primary-500 mb-2">Known Allergies</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {allergies.map((a) => (
                      <span key={a.allergy_id} className="badge-danger">{a.allergen} ({a.severity})</span>
                    ))}
                  </div>
                </div>
              )}

              {!noConsent && (recentDx.length > 0 || activeRx.length > 0) && (
                <div className="card">
                  <h3 className="font-semibold text-primary-500 mb-2">EHR Summary</h3>
                  {recentDx.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs uppercase text-gray-500 mb-1">Recent Diagnoses</div>
                      <ul className="text-sm space-y-0.5">
                        {recentDx.map((r) => <li key={r.record_id} className="text-gray-700 truncate">• {r.title}</li>)}
                      </ul>
                    </div>
                  )}
                  {activeRx.length > 0 && (
                    <div>
                      <div className="text-xs uppercase text-gray-500 mb-1">Active Prescriptions</div>
                      <ul className="text-sm space-y-0.5">
                        {activeRx.map((r) => <li key={r.record_id} className="text-gray-700 truncate">• {r.title}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Consent-gated interactive EHR (X-ray / MRI / chest analysis).
                  AI tools are filtered by the doctor's specialty. */}
              <PatientEHRPanel
                patientUuid={consultation.patient_uuid}
                onAccessChange={setEHRAccessGranted}
                doctorDepartment={user?.specialization || consultation?.doctor_specialization || ''}
              />
            </div>
          )}

          {/* ─── Chat ──────────────────────────────────── */}
          {activeTab === 'chat' && (
            <ConsultationChat
              consultationId={consultation_id}
              sender="doctor"
              senderName={`Dr. ${user?.full_name || consultation.doctor_name || ''}`.trim()}
            />
          )}

          {/* ─── Prescription writer ───────────────────── */}
          {activeTab === 'rx' && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <FiFilePlus className="text-primary-500" />
                <h3 className="font-semibold text-primary-500">Prescription Writer</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormInput label="Medicine" placeholder="e.g. Paracetamol 500mg"
                  value={med.name} onChange={(e) => setMed({ ...med, name: e.target.value })} />
                <FormInput label="Dosage" placeholder="500 mg"
                  value={med.dosage} onChange={(e) => setMed({ ...med, dosage: e.target.value })} />
                <FormInput label="Frequency" as="select" value={med.frequency}
                  onChange={(e) => setMed({ ...med, frequency: e.target.value })}
                  options={FREQUENCIES} />
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
              <div className="mt-3">
                <FormInput label="Valid Until (optional)" type="date"
                  value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
              <div className="flex justify-end mt-3">
                <button onClick={generatePrescription} disabled={generatingRx || medicines.length === 0}
                  className="btn-orange disabled:opacity-60 w-full">
                  {generatingRx ? 'Generating PDF…' : 'Generate Prescription PDF'}
                </button>
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
          )}

          {/* ─── Lab orders ────────────────────────────── */}
          {activeTab === 'lab' && (
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
              <div className="space-y-3">
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
          )}

          {/* ─── AI diagnosis ──────────────────────────── */}
          {activeTab === 'ai' && (
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
              {aiSyms.length > 0 && (
                <div className="text-xs text-gray-500 mb-2">{aiSyms.length} selected</div>
              )}
              {flMaintenance && (
                <div className="rounded-2xl p-3 mb-3 border-2 flex items-center gap-3" style={{ backgroundColor: '#FFF7ED', borderColor: '#FED7AA' }}>
                  <span className="text-xl">🔧</span>
                  <div>
                    <p className="font-bold text-sm" style={{ color: '#F97316' }}>AI Services Under Maintenance</p>
                    <p className="text-xs text-gray-500">FL model is being retrained. AI diagnosis is temporarily unavailable.</p>
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
                        <div className="h-full bg-gradient-to-r from-primary-400 to-accent" style={{ width: `${Math.min(d.confidence, 100)}%` }} />
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
                        {aiResult.risk_flags.map((f, i) => <li key={i}>⚠️ {f}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Notes ─────────────────────────────────── */}
          {activeTab === 'notes' && (
            <div className="card">
              <h3 className="font-semibold text-primary-500 mb-3">Consultation Notes</h3>
              <FormInput label="Doctor Notes" as="textarea" rows={5}
                value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, history…" />
              <div className="mt-4">
                <FormInput label="Final Diagnosis"
                  value={finalDx} onChange={(e) => setFinalDx(e.target.value)} placeholder="Primary diagnosis" />
              </div>
              <div className="flex flex-col gap-2 mt-4">
                <button onClick={() => saveNotes(false)} disabled={savingNotes} className="btn-secondary inline-flex items-center justify-center gap-2 disabled:opacity-60">
                  <FiSave className="w-4 h-4" /> Save Notes
                </button>
                <button onClick={() => saveNotes(true)} disabled={savingNotes} className="btn-orange disabled:opacity-60">
                  Complete Consultation
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConsultationRoom;
