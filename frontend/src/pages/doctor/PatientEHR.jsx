import { useMemo, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import {
  FiAlertOctagon, FiDownload, FiChevronDown, FiChevronUp, FiArrowLeft,
  FiCamera, FiKey,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import QRScanner from '../../components/common/QRScanner';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const TABS = [
  { key: 'all',          label: 'All' },
  { key: 'diagnosis',    label: 'Diagnoses' },
  { key: 'lab',          label: 'Lab Reports' },
  { key: 'prescription', label: 'Prescriptions' },
  { key: 'history',      label: 'History' },
  { key: 'allergies',    label: 'Allergies' },
];

const SEVERITY_BADGE = { mild: 'badge-warning', moderate: 'badge-warning', severe: 'badge-danger' };

/** A scanned QR encodes a URL like .../patient/qr/<uuid>. Pull out the token. */
const extractToken = (raw) => {
  if (!raw) return '';
  const text = String(raw).trim();
  const marker = '/patient/qr/';
  if (text.includes(marker)) {
    return text.split(marker)[1].split(/[/?#]/)[0].trim();
  }
  return text;
};

const PatientEHR = () => {
  const { patient_id } = useParams();
  const ehr = useApi(`/api/doctor/patient-ehr/${patient_id}/`);
  const [tab, setTab] = useState('all');
  const [expanded, setExpanded] = useState({});

  // Consent gate state
  const [showScanner, setShowScanner] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [validating, setValidating] = useState(false);

  // 6-digit short-code entry (one box per digit)
  const [digits, setDigits] = useState(Array(6).fill(''));
  const inputRefs = useRef([]);

  const records = useMemo(() => ehr.data?.ehr_records || [], [ehr.data]);
  const allergies = ehr.data?.allergies || [];
  const patient = ehr.data?.patient;

  const filtered = tab === 'all' ? records : records.filter((r) => r.record_type === tab);
  const noConsent = ehr.error?.response?.status === 403;

  // ─── Consent validation ─────────────────────────────────────
  const validateConsent = async (rawToken) => {
    const token = extractToken(rawToken);
    if (!token) {
      toast.error('No token detected.');
      return;
    }
    setValidating(true);
    try {
      const { data } = await API.post('/api/doctor/validate-consent/', {
        token,
        patient_id,
      });
      if (data?.success) {
        toast.success('Access granted! Valid for 30 minutes.');
        setManualMode(false);
        setManualToken('');
        setDigits(Array(6).fill(''));
        ehr.refetch();
      } else {
        toast.error(data?.message || 'Invalid or expired token!');
        setDigits(Array(6).fill(''));
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Invalid or expired token!');
    } finally {
      setValidating(false);
    }
  };

  const onScanDetect = (text) => {
    setShowScanner(false);
    validateConsent(text);
  };

  if (ehr.loading) {
    return <DashboardLayout><div className="card">Loading EHR…</div></DashboardLayout>;
  }

  // ─── Consent gate ───────────────────────────────────────────
  if (noConsent) {
    return (
      <DashboardLayout>
        <Link to="/doctor" className="inline-flex items-center gap-1 text-sm text-primary-500 hover:underline mb-4">
          <FiArrowLeft /> Back
        </Link>
        <div className="card text-center py-10 max-w-lg mx-auto">
          <FiAlertOctagon className="w-12 h-12 mx-auto text-warning mb-3" />
          <h2 className="text-xl font-bold text-primary-500 mb-1">Consent Required</h2>
          <p className="text-sm text-gray-600 max-w-md mx-auto mb-6">
            This patient's EHR is private. Verify consent using their FederCare QR
            code — scan it with the camera, or enter the token manually.
          </p>

          {/* Option 1 — Scan QR (camera) */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => setShowScanner(true)}
              className="btn-primary inline-flex items-center justify-center gap-2"
            >
              <FiCamera className="w-4 h-4" /> Scan Patient QR Code
            </button>
            <button
              onClick={() => setManualMode((v) => !v)}
              className="btn-secondary inline-flex items-center justify-center gap-2"
            >
              <FiKey className="w-4 h-4" /> Enter QR Token Manually
            </button>
          </div>

          {/* OR divider */}
          <div className="flex items-center gap-3 max-w-sm mx-auto my-5">
            <hr className="flex-1" />
            <span className="text-gray-400 text-sm">OR</span>
            <hr className="flex-1" />
          </div>

          {/* Option 2 — 6-digit short code (auto-submits on the 6th digit) */}
          <div>
            <p className="text-sm font-medium text-gray-700 text-center mb-3">
              🔢 Enter 6-Digit Code
            </p>
            <div className="flex justify-center gap-2">
              {digits.map((digit, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  disabled={validating}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!/^\d*$/.test(val)) return;
                    const newDigits = [...digits];
                    newDigits[i] = val;
                    setDigits(newDigits);
                    if (val && i < 5) {
                      inputRefs.current[i + 1]?.focus();
                    }
                    if (i === 5 && val) {
                      const code = newDigits.join('');
                      if (code.length === 6) validateConsent(code);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Backspace' && !digit && i > 0) {
                      inputRefs.current[i - 1]?.focus();
                    }
                  }}
                  className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-300 rounded-xl focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              ))}
            </div>
            <p className="text-xs text-gray-400 text-center mt-2">
              Patient will read you this code
            </p>
          </div>

          {manualMode && (
            <div className="mt-5 max-w-sm mx-auto text-left">
              <label className="text-xs text-gray-500 mb-1 block">
                QR Token (patient reads this to you)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="e.g. 3f2c…-…-…"
                  className="input-field flex-1"
                />
                <button
                  onClick={() => validateConsent(manualToken)}
                  disabled={validating || !manualToken.trim()}
                  className="btn-primary disabled:opacity-60"
                >
                  {validating ? '…' : 'Submit'}
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-5">
            QR consents expire 30 minutes after the patient generates them.
          </p>
        </div>

        {showScanner && (
          <QRScanner onDetect={onScanDetect} onClose={() => setShowScanner(false)} />
        )}
      </DashboardLayout>
    );
  }

  if (ehr.error) {
    return <DashboardLayout><div className="card text-danger">Could not load EHR.</div></DashboardLayout>;
  }

  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));
  const safeFmt = (iso) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'dd MMM yyyy, HH:mm'); } catch { return iso; }
  };

  return (
    <DashboardLayout>
      <Link to="/doctor" className="inline-flex items-center gap-1 text-sm text-primary-500 hover:underline mb-4">
        <FiArrowLeft /> Back to Dashboard
      </Link>

      {patient && (
        <div className="card mb-5">
          <h1 className="text-xl font-bold text-primary-500">{patient.full_name}</h1>
          <div className="text-sm text-gray-600 grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
            <div><span className="text-gray-400">DOB:</span> {patient.dob}</div>
            <div><span className="text-gray-400">Gender:</span> {patient.gender || '—'}</div>
            <div><span className="text-gray-400">Blood:</span> {patient.blood_group || '—'}</div>
            <div><span className="text-gray-400">BMI:</span> {patient.bmi || '—'}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-5 border-b border-gray-200 pb-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
              tab === t.key ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-primary-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'allergies' ? (
        allergies.length === 0 ? (
          <div className="card text-sm text-gray-500">No allergies recorded.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {allergies.map((a) => (
              <div key={a.allergy_id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <div className="font-semibold text-primary-500">{a.allergen}</div>
                  <span className={SEVERITY_BADGE[a.severity] || 'badge-info'}>{a.severity}</span>
                </div>
                <p className="text-sm text-gray-600">{a.reaction || '—'}</p>
                <p className="text-xs text-gray-400 mt-2">Noted: {safeFmt(a.noted_at)}</p>
              </div>
            ))}
          </div>
        )
      ) : (
        filtered.length === 0 ? (
          <div className="card text-sm text-gray-500 text-center py-8">No records in this category.</div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const isOpen = expanded[r.record_id];
              return (
                <div key={r.record_id} className="card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge status="info" text={r.record_type} />
                        <span className="text-xs text-gray-500">{safeFmt(r.recorded_at)}</span>
                      </div>
                      <div className="font-semibold text-primary-500">{r.title || '—'}</div>
                      {r.content && (
                        <p className={`text-sm text-gray-600 mt-1 ${isOpen ? '' : 'line-clamp-2'}`}>
                          {r.content}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {r.file_url && (
                        <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="text-primary-500 hover:underline text-sm inline-flex items-center gap-1">
                          <FiDownload className="w-4 h-4" /> Download
                        </a>
                      )}
                      <button onClick={() => toggle(r.record_id)} className="text-xs text-gray-500 inline-flex items-center gap-1 hover:text-primary-500">
                        {isOpen ? <FiChevronUp /> : <FiChevronDown />}
                        {isOpen ? 'Collapse' : 'View Full'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}
    </DashboardLayout>
  );
};

export default PatientEHR;
