import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import DashboardLayout from '../../components/common/DashboardLayout';
import Modal from '../../components/common/Modal';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { openRazorpay } from '../../utils/payment';

// Medically accurate international reference ranges, keyed by lowercased test
// name (matched directly or by substring). `null` low/high = qualitative or
// panel test (Positive/Negative or "see components"), shown without a range.
const LAB_REFERENCE_RANGES = {
  // ─── Blood sugar ───────────────────────────────────────────────────
  'blood sugar fasting': { normal_low: 70, normal_high: 99, unit: 'mg/dL', critical_low: 40, critical_high: 500, note: 'Prediabetes: 100-125, Diabetes: ≥126' },
  'blood sugar random': { normal_low: 70, normal_high: 139, unit: 'mg/dL', critical_low: 40, critical_high: 500, note: 'Diabetes if ≥200 with symptoms' },
  hba1c: { normal_low: 4.0, normal_high: 5.6, unit: '%', critical_low: 0, critical_high: 9.0, note: 'Prediabetes: 5.7-6.4%, Diabetes: ≥6.5%' },

  // ─── Complete blood count ──────────────────────────────────────────
  'complete blood count': { normal_low: null, normal_high: null, unit: 'Panel', critical_low: null, critical_high: null, note: 'See individual components' },
  hemoglobin: { normal_low: 12.0, normal_high: 17.5, unit: 'g/dL', critical_low: 7.0, critical_high: 20.0, note: 'Men: 13.5-17.5, Women: 12.0-15.5' },
  wbc: { normal_low: 4000, normal_high: 11000, unit: 'cells/μL', critical_low: 2000, critical_high: 30000, note: 'High WBC may indicate infection' },
  platelet: { normal_low: 150000, normal_high: 400000, unit: '/μL', critical_low: 50000, critical_high: 1000000, note: 'Critical low: bleeding risk' },
  esr: { normal_low: 0, normal_high: 20, unit: 'mm/hr', critical_low: 0, critical_high: 100, note: 'Men: 0-15, Women: 0-20 mm/hr' },

  // ─── Lipid profile ─────────────────────────────────────────────────
  'lipid profile': { normal_low: null, normal_high: 200, unit: 'mg/dL', critical_low: null, critical_high: 240, note: 'Total cholesterol <200 desirable' },
  cholesterol: { normal_low: 0, normal_high: 200, unit: 'mg/dL', critical_low: 0, critical_high: 240, note: 'Desirable <200, High ≥240' },
  triglycerides: { normal_low: 0, normal_high: 150, unit: 'mg/dL', critical_low: 0, critical_high: 500, note: 'High ≥200, Very high ≥500' },
  hdl: { normal_low: 40, normal_high: 200, unit: 'mg/dL', critical_low: 25, critical_high: null, note: 'Higher is better. Low <40 men, <50 women' },
  ldl: { normal_low: 0, normal_high: 100, unit: 'mg/dL', critical_low: null, critical_high: 160, note: 'Optimal <100, High ≥160' },

  // ─── Liver function ────────────────────────────────────────────────
  'liver function test': { normal_low: null, normal_high: null, unit: 'Panel', critical_low: null, critical_high: null, note: 'See individual components' },
  alt: { normal_low: 7, normal_high: 45, unit: 'U/L', critical_low: null, critical_high: 200, note: 'High ALT indicates liver injury' },
  ast: { normal_low: 10, normal_high: 40, unit: 'U/L', critical_low: null, critical_high: 200, note: 'High AST indicates liver/heart damage' },
  bilirubin: { normal_low: 0.2, normal_high: 1.2, unit: 'mg/dL', critical_low: null, critical_high: 15.0, note: 'High causes jaundice' },
  albumin: { normal_low: 3.5, normal_high: 5.0, unit: 'g/dL', critical_low: 2.0, critical_high: null, note: 'Low indicates liver/kidney disease' },

  // ─── Kidney function ───────────────────────────────────────────────
  'kidney function test': { normal_low: null, normal_high: null, unit: 'Panel', critical_low: null, critical_high: null, note: 'See individual components' },
  creatinine: { normal_low: 0.6, normal_high: 1.2, unit: 'mg/dL', critical_low: 0, critical_high: 10.0, note: 'Men: 0.7-1.3, Women: 0.6-1.1' },
  urea: { normal_low: 7, normal_high: 20, unit: 'mg/dL', critical_low: 0, critical_high: 100, note: 'BUN normal: 7-20 mg/dL' },
  'uric acid': { normal_low: 3.5, normal_high: 7.2, unit: 'mg/dL', critical_low: 0, critical_high: 12.0, note: 'Men: 3.4-7.0, Women: 2.4-6.0' },

  // ─── Electrolytes ──────────────────────────────────────────────────
  sodium: { normal_low: 136, normal_high: 145, unit: 'mEq/L', critical_low: 120, critical_high: 160, note: 'Critical: <120 or >160 mEq/L' },
  potassium: { normal_low: 3.5, normal_high: 5.0, unit: 'mEq/L', critical_low: 2.5, critical_high: 6.5, note: 'Critical: <2.5 or >6.5 mEq/L' },
  calcium: { normal_low: 8.5, normal_high: 10.5, unit: 'mg/dL', critical_low: 6.0, critical_high: 14.0, note: 'Critical: <6.0 or >14.0 mg/dL' },

  // ─── Thyroid ───────────────────────────────────────────────────────
  tsh: { normal_low: 0.4, normal_high: 4.0, unit: 'mIU/L', critical_low: 0.1, critical_high: 10.0, note: 'High TSH=Hypothyroid, Low TSH=Hyperthyroid' },
  'thyroid stimulating hormone': { normal_low: 0.4, normal_high: 4.0, unit: 'mIU/L', critical_low: 0.1, critical_high: 10.0, note: 'High TSH=Hypothyroid, Low TSH=Hyperthyroid' },
  t3: { normal_low: 80, normal_high: 200, unit: 'ng/dL', critical_low: 40, critical_high: 400, note: 'Free T3: 3.5-7.8 pmol/L' },
  t4: { normal_low: 5.0, normal_high: 12.0, unit: 'μg/dL', critical_low: 2.0, critical_high: 20.0, note: 'Free T4: 9-24 pmol/L' },
  'anti-tpo': { normal_low: 0, normal_high: 34, unit: 'IU/mL', critical_low: null, critical_high: 500, note: 'Normal <34 IU/mL. >35 indicates autoimmune thyroid disease' },
  'thyroid profile': { normal_low: 0.4, normal_high: 4.0, unit: 'mIU/L', critical_low: 0.1, critical_high: 10.0, note: 'T3, T4, TSH panel' },

  // ─── Vitamins ──────────────────────────────────────────────────────
  'vitamin d': { normal_low: 30, normal_high: 100, unit: 'ng/mL', critical_low: 10, critical_high: 150, note: 'Deficient <20, Insufficient 20-29, Normal ≥30' },
  'vitamin d3': { normal_low: 30, normal_high: 100, unit: 'ng/mL', critical_low: 10, critical_high: 150, note: 'Deficient <20, Insufficient 20-29' },
  'vitamin b12': { normal_low: 200, normal_high: 900, unit: 'pg/mL', critical_low: 100, critical_high: 2000, note: 'Deficient <200, Normal 200-900 pg/mL' },
  folate: { normal_low: 3.1, normal_high: 17.5, unit: 'ng/mL', critical_low: 2.0, critical_high: null, note: 'Deficient <3.1 ng/mL' },

  // ─── Iron studies ──────────────────────────────────────────────────
  iron: { normal_low: 60, normal_high: 170, unit: 'μg/dL', critical_low: 30, critical_high: 300, note: 'Men: 65-175, Women: 50-170 μg/dL' },
  'iron studies': { normal_low: 60, normal_high: 170, unit: 'μg/dL', critical_low: 30, critical_high: 300, note: 'Serum Iron normal range' },
  ferritin: { normal_low: 12, normal_high: 300, unit: 'ng/mL', critical_low: 5, critical_high: 1000, note: 'Men: 12-300, Women: 12-150 ng/mL' },

  // ─── Inflammation ──────────────────────────────────────────────────
  crp: { normal_low: 0, normal_high: 5.0, unit: 'mg/L', critical_low: null, critical_high: 100, note: 'High sensitivity CRP <1.0 low risk' },
  'c-reactive protein': { normal_low: 0, normal_high: 5.0, unit: 'mg/L', critical_low: null, critical_high: 100, note: '<1 low, 1-3 moderate, >3 high risk' },

  // ─── Urine ─────────────────────────────────────────────────────────
  'urine routine': { normal_low: null, normal_high: null, unit: 'Panel', critical_low: null, critical_high: null, note: 'Normal: No blood, protein, glucose, bacteria' },
  microalbumin: { normal_low: 0, normal_high: 30, unit: 'mg/g', critical_low: null, critical_high: 300, note: 'Normal <30, Microalbuminuria 30-300' },
  'urine protein': { normal_low: 0, normal_high: 150, unit: 'mg/day', critical_low: null, critical_high: 3500, note: 'Nephrotic syndrome >3500 mg/day' },

  // ─── Hormones ──────────────────────────────────────────────────────
  fsh: { normal_low: 1.4, normal_high: 18.1, unit: 'IU/L', critical_low: 0, critical_high: 100, note: 'Women follicular: 1.37-9.9, Men: 1.42-15.4' },
  lh: { normal_low: 1.5, normal_high: 16.9, unit: 'IU/L', critical_low: 0, critical_high: 100, note: 'Varies by menstrual phase' },
  prolactin: { normal_low: 3, normal_high: 27, unit: 'ng/mL', critical_low: 0, critical_high: 200, note: 'Men: 3-13, Women: 3-27 ng/mL' },
  testosterone: { normal_low: 270, normal_high: 1070, unit: 'ng/dL', critical_low: 100, critical_high: 1200, note: 'Men: 270-1070, Women: 15-70 ng/dL' },
  cortisol: { normal_low: 6, normal_high: 23, unit: 'μg/dL', critical_low: 2, critical_high: 50, note: 'Morning 8-9 AM: 6-23 μg/dL' },
  insulin: { normal_low: 2, normal_high: 25, unit: 'μIU/mL', critical_low: 0, critical_high: 100, note: 'Fasting insulin: 2-25 μIU/mL' },

  // ─── Cancer markers ────────────────────────────────────────────────
  psa: { normal_low: 0, normal_high: 4.0, unit: 'ng/mL', critical_low: null, critical_high: 10.0, note: 'Normal ≤4.0 ng/mL. >10 high risk' },
  'ca-125': { normal_low: 0, normal_high: 35, unit: 'U/mL', critical_low: null, critical_high: 200, note: 'Normal <35 U/mL' },
  cea: { normal_low: 0, normal_high: 2.5, unit: 'ng/mL', critical_low: null, critical_high: 20, note: 'Non-smokers ≤2.5, Smokers ≤5.0 ng/mL' },
  afp: { normal_low: 0, normal_high: 8.5, unit: 'ng/mL', critical_low: null, critical_high: 400, note: 'Normal <8.5 ng/mL' },

  // ─── Cardiac ───────────────────────────────────────────────────────
  troponin: { normal_low: 0, normal_high: 0.04, unit: 'ng/mL', critical_low: null, critical_high: 0.4, note: 'Any elevation suggests heart damage. >0.04 ng/mL abnormal' },
  'troponin i': { normal_low: 0, normal_high: 0.04, unit: 'ng/mL', critical_low: null, critical_high: 0.4, note: 'Normal <0.04 ng/mL' },
  'ck-mb': { normal_low: 0, normal_high: 5.0, unit: 'ng/mL', critical_low: null, critical_high: 25, note: 'Normal <5 ng/mL' },

  // ─── Infection markers (qualitative) ───────────────────────────────
  dengue: { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Positive or Negative' },
  malaria: { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Positive or Negative' },
  typhoid: { normal_low: null, normal_high: null, unit: 'Titre', critical_low: null, critical_high: null, note: 'Titre <1:80 usually normal' },
  hiv: { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Reactive or Non-reactive' },
  'hepatitis b': { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Positive or Negative' },
  'hepatitis c': { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Positive or Negative' },
  vdrl: { normal_low: null, normal_high: null, unit: 'Qualitative', critical_low: null, critical_high: null, note: 'Result: Reactive or Non-reactive' },
};

const getTestStatus = (testName, value) => {
  if (!testName || value === undefined || value === null || value === '') return null;

  const name = String(testName).toLowerCase().trim();
  let range = LAB_REFERENCE_RANGES[name] || null;
  if (!range) {
    for (const [key, val] of Object.entries(LAB_REFERENCE_RANGES)) {
      if (name.includes(key) || key.includes(name)) { range = val; break; }
    }
  }

  // Qualitative / panel test (no numeric range) → show the raw value.
  if (!range || (range.normal_low === null && range.normal_high === null)) {
    return { status: 'qualitative', label: String(value), color: '#666666', note: range?.note || '' };
  }

  const numValue = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  if (Number.isNaN(numValue)) {
    return { status: 'qualitative', label: String(value), color: '#666666', note: range.note };
  }

  const fullRange = range.normal_low !== null
    ? `${range.normal_low}-${range.normal_high} ${range.unit}`
    : null;

  // Critical uses inclusive bounds so a value sitting exactly on the critical
  // threshold (e.g. Anti-TPO 500) reads as Critical, not merely High.
  if (range.critical_low !== null && numValue <= range.critical_low) {
    return { status: 'critical', label: 'Critical Low', color: '#EF4444', range: fullRange, note: range.note };
  }
  if (range.critical_high !== null && numValue >= range.critical_high) {
    return { status: 'critical', label: 'Critical High', color: '#EF4444', range: range.normal_high !== null ? fullRange : null, note: range.note };
  }
  if (range.normal_low !== null && numValue < range.normal_low) {
    return { status: 'low', label: 'Low', color: '#F97316', range: fullRange, note: range.note };
  }
  if (range.normal_high !== null && numValue > range.normal_high) {
    return {
      status: 'high',
      label: 'High',
      color: '#F97316',
      range: `${range.normal_low !== null ? range.normal_low : 0}-${range.normal_high} ${range.unit}`,
      note: range.note,
    };
  }
  return { status: 'normal', label: 'Normal', color: '#22C55E', range: fullRange, note: range.note };
};

// Results may arrive as an array, object, or JSON string — normalise to an array.
const parseResults = (results) => {
  if (!results) return [];
  if (Array.isArray(results)) return results;
  if (typeof results === 'string') {
    try { return parseResults(JSON.parse(results)); } catch { return [{ test_name: 'Result', value: results, unit: '' }]; }
  }
  if (typeof results === 'object') {
    return Object.entries(results).map(([key, val]) => (
      val && typeof val === 'object'
        ? { test_name: key, value: val.value ?? '', unit: val.unit ?? '' }
        : { test_name: key, value: val, unit: '' }
    ));
  }
  return [];
};

const testLabel = (record) =>
  (record.tests || []).map((t) => (typeof t === 'object' ? t.name : t)).join(', ') || 'Lab Test';

const fmtDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return ''; }
};

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: '⏳ Pending' },
  { key: 'pending_verification', label: '📋 Rx Verification' },
  { key: 'completed', label: '✓ Completed' },
  { key: 'no_show', label: '😔 Missed' },
];

const TestRecordsPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedResult, setSelectedResult] = useState(null);

  const fetchRecords = useCallback(async () => {
    try {
      const res = await API.get('/api/patient/lab/orders/');
      if (res.data?.success) setRecords(res.data.data?.orders || []);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const filtered = records.filter((r) => (activeTab === 'all' ? true : r.status === activeTab));
  const tabCount = (key) => (key === 'all' ? records.length : records.filter((r) => r.status === key).length);

  const handlePayment = (record) => {
    if (!record.razorpay_order_id || !record.razorpay_key_id) {
      return undefined;
    }
    return openRazorpay({
      orderId: record.razorpay_order_id,
      amount: record.razorpay_amount,
      keyId: record.razorpay_key_id,
      paymentType: 'lab_test',
      objectId: record.order_id,
      user,
      description: 'Lab test payment',
      onSuccess: fetchRecords,
    });
  };

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-black">🔬 Test Records</h1>
          <p className="text-gray-500 text-sm">Your lab test history and results</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap"
              style={{
                backgroundColor: activeTab === tab.key ? '#F97316' : '#FFFFFF',
                color: activeTab === tab.key ? '#FFFFFF' : '#000000',
                border: activeTab === tab.key ? 'none' : '1px solid #E5E5E5',
              }}
            >
              {tab.label}
              <span className="ml-1">({tabCount(tab.key)})</span>
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-12">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
            <p className="text-5xl mb-4">🔬</p>
            <p className="font-semibold text-gray-700">No test records found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((record) => (
              <div key={record.order_id} className="bg-white rounded-2xl p-5 border border-gray-100">
                {/* Top row */}
                <div className="flex items-start justify-between mb-3 gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-black">{testLabel(record)}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {record.hospital_name ? `${record.hospital_name} · ` : ''}{fmtDate(record.ordered_at)} · ₹{record.total_fee}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-3 py-1 rounded-full font-medium whitespace-nowrap ${
                      record.status === 'completed'
                        ? 'bg-green-100 text-green-700'
                        : record.status === 'pending_verification'
                          ? 'bg-yellow-100 text-yellow-700'
                          : record.status === 'no_show'
                            ? 'bg-red-100 text-red-600'
                            : record.status === 'cancelled'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-orange-100 text-orange-700'
                    }`}
                  >
                    {record.status === 'completed'
                      ? '✓ Completed'
                      : record.status === 'pending_verification'
                        ? '📋 Rx Pending'
                        : record.status === 'no_show'
                          ? '😔 Missed'
                          : record.status === 'cancelled'
                            ? '✕ Cancelled'
                            : '⏳ Pending'}
                  </span>
                </div>

                {/* Prescription status */}
                {record.prescription_required && (
                  <div
                    className={`rounded-xl p-2 mb-3 text-xs font-medium ${
                      record.prescription_status === 'verified'
                        ? 'bg-green-50 text-green-700'
                        : record.prescription_status === 'pending'
                          ? 'bg-yellow-50 text-yellow-700'
                          : record.prescription_status === 'rejected'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-blue-50 text-blue-600'
                    }`}
                  >
                    {record.prescription_status === 'verified'
                      ? '✅ Prescription Verified'
                      : record.prescription_status === 'pending'
                        ? '⏳ Prescription Under Review'
                        : record.prescription_status === 'rejected'
                          ? '❌ Prescription Rejected'
                          : '📋 Doctor Referred'}
                  </div>
                )}

                {/* Missed appointment (no-show) */}
                {record.status === 'no_show' && (
                  <div className="rounded-xl p-3 mt-1 mb-1" style={{ backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5' }}>
                    <p className="font-bold text-[13px] m-0 mb-1" style={{ color: '#EF4444' }}>😔 Appointment Missed</p>
                    <p className="text-xs text-gray-600 m-0 mb-2">
                      {record.no_show_marked_by === 'lab_tech'
                        ? 'Marked as no-show by lab staff.'
                        : 'You did not attend this appointment.'}
                      {' '}No refund is applicable.
                    </p>
                    <button
                      type="button"
                      onClick={() => navigate('/patient/lab')}
                      className="w-full py-2 rounded-lg text-[13px] font-semibold text-white"
                      style={{ backgroundColor: '#F97316' }}
                    >
                      🔄 Rebook Test
                    </button>
                  </div>
                )}

                {/* Pay now — prescription verified but not yet paid */}
                {record.prescription_status === 'verified' && record.payment_status === 'pending' && (
                  <button
                    type="button"
                    onClick={() => handlePayment(record)}
                    className="w-full py-2 rounded-full text-sm font-bold text-white mb-3"
                    style={{ backgroundColor: '#F97316' }}
                  >
                    Pay ₹{record.total_fee} Now
                  </button>
                )}

                {/* View results */}
                {record.status === 'completed'
                  && Object.keys(record.report_results || {}).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedResult(record)}
                    className="w-full py-2 rounded-full text-sm font-semibold border-2"
                    style={{ borderColor: '#F97316', color: '#F97316', backgroundColor: 'white' }}
                  >
                    View Results →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results modal (FIX 2) */}
      <Modal isOpen={Boolean(selectedResult)} onClose={() => setSelectedResult(null)} title="Test Results">
        {selectedResult && (
          <div>
            {parseResults(selectedResult.report_results).length === 0 ? (
              <p className="text-sm text-gray-500">No detailed values recorded.</p>
            ) : (
              parseResults(selectedResult.report_results).map((result, index) => {
                const status = getTestStatus(result.test_name || result.name, result.value);
                const isAbnormal = status && (status.status === 'low' || status.status === 'high');
                return (
                  <div
                    key={index}
                    className="rounded-xl p-4 mb-3"
                    style={{
                      backgroundColor: !status ? '#F9FAFB'
                        : status.status === 'critical' ? '#FEF2F2'
                          : isAbnormal ? '#FFF7ED'
                            : status.status === 'normal' ? '#F0FDF4'
                              : '#F9FAFB',
                      border: `1px solid ${
                        !status ? '#E5E5E5'
                          : status.status === 'critical' ? '#FCA5A5'
                            : isAbnormal ? '#FED7AA'
                              : status.status === 'normal' ? '#86EFAC'
                                : '#E5E5E5'
                      }`,
                    }}
                  >
                    {/* Test name + status */}
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-bold text-black text-sm">
                        {result.test_name || result.name || 'Lab Test'}
                      </p>
                      {status && status.status !== 'qualitative' && (
                        <span
                          className="text-xs px-2 py-1 rounded-full font-bold"
                          style={{
                            backgroundColor: status.status === 'critical' ? '#FEE2E2'
                              : status.status === 'normal' ? '#DCFCE7' : '#FFF7ED',
                            color: status.color,
                          }}
                        >
                          {status.status === 'critical' ? `🔴 ${status.label}`
                            : status.status === 'normal' ? '🟢 Normal'
                              : `🟠 ${status.label}`}
                        </span>
                      )}
                    </div>

                    {/* Value + normal range */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold" style={{ color: status?.color || '#000000' }}>
                          {result.value || 'N/A'}
                        </span>
                        <span className="text-sm text-gray-400">
                          {result.unit || status?.range?.split(' ').slice(-1)[0] || ''}
                        </span>
                      </div>
                      {status?.range && (
                        <div className="text-right">
                          <p className="text-xs text-gray-400">Normal Range</p>
                          <p className="text-xs font-semibold text-gray-600">{status.range}</p>
                        </div>
                      )}
                    </div>

                    {/* Medical note */}
                    {status?.note && (
                      <p className="text-xs text-gray-400 mt-2 italic">{status.note}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </Modal>
    </DashboardLayout>
  );
};

export default TestRecordsPage;
