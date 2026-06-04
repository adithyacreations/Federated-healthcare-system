import { useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import toast from 'react-hot-toast';
import { FiHeart, FiActivity, FiDroplet, FiCheck } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import FormInput from '../../components/auth/FormInput';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const RING_SIZE = 140;
const RING_STROKE = 12;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

const colorFor = (val) => {
  if (val == null) return '#9ca3af';
  if (val < 40) return '#06D6A0';
  if (val < 70) return '#F59E0B';
  return '#EF4444';
};

const RiskRing = ({ label, value, color, icon: Icon }) => {
  const v = value ?? 0;
  const offset = RING_CIRC * (1 - v / 100);
  return (
    <div className="card flex flex-col items-center text-center">
      <div className="relative" style={{ width: RING_SIZE, height: RING_SIZE }}>
        <svg width={RING_SIZE} height={RING_SIZE}>
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke="#e5e7eb"
            strokeWidth={RING_STROKE}
            fill="none"
          />
          <motion.circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            stroke={color}
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={RING_CIRC}
            initial={{ strokeDashoffset: RING_CIRC }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1, ease: 'easeOut' }}
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-3xl font-bold" style={{ color }}>{v}%</div>
          {Icon && <Icon className="w-5 h-5 mt-1" style={{ color }} />}
        </div>
      </div>
      <div className="mt-3 text-sm font-medium text-gray-700">{label}</div>
    </div>
  );
};

const RiskReport = () => {
  const report = useApi('/api/patient/risk-report/');
  const history = useApi('/api/ai/risk-history/');
  const [form, setForm] = useState({
    age: '',
    blood_pressure_systolic: '',
    blood_pressure_diastolic: '',
    glucose_level: '',
    cholesterol: '',
    smoking: false,
    exercise: false,
    family_history_diabetes: false,
    family_history_heart: false,
  });
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toggle = (k) => () => setForm({ ...form, [k]: !form[k] });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.age) return toast.error('Age is required');
    setSubmitting(true);
    try {
      await API.post('/api/ai/risk-predict/', {
        ...form,
        age: Number(form.age),
        blood_pressure_systolic: Number(form.blood_pressure_systolic) || 0,
        blood_pressure_diastolic: Number(form.blood_pressure_diastolic) || 0,
        glucose_level: Number(form.glucose_level) || 0,
        cholesterol: Number(form.cholesterol) || 0,
      });
      toast.success('Risk assessment completed');
      report.refetch();
      history.refetch();
    } catch (err) {
      const data = err?.response?.data;
      toast.error(data?.message || 'Risk assessment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const r = report.data;
  const hasAssessment = r?.has_assessment;

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-500">AI Health Risk Report</h1>
        <p className="text-sm text-gray-500">Based on your vitals and family history.</p>
      </div>

      {/* Latest results ─────────────────────────────────── */}
      {hasAssessment && (
        <section className="mb-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <RiskRing label="Diabetes Risk"     value={r.diabetes_risk}     color={colorFor(r.diabetes_risk)}     icon={FiDroplet} />
            <RiskRing label="Heart Disease Risk" value={r.heart_risk}        color={colorFor(r.heart_risk)}        icon={FiHeart} />
            <RiskRing label="Hypertension Risk" value={r.hypertension_risk} color={colorFor(r.hypertension_risk)} icon={FiActivity} />
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-primary-500">Overall Risk Level</h3>
              <Badge status={r.risk_level} />
            </div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Recommendations</h4>
            <ul className="space-y-1.5 text-sm text-gray-700">
              {(r.recommendations || '').split(/\s*\|\s*/).filter(Boolean).map((rec, i) => (
                <li key={i} className="flex items-start gap-2">
                  <FiCheck className="w-4 h-4 text-success mt-0.5 flex-shrink-0" />
                  <span>{rec}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Submission form ────────────────────────────────── */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold text-primary-500 mb-3">
          {hasAssessment ? 'Run a New Assessment' : 'Generate Your Risk Report'}
        </h3>
        <form onSubmit={submit} className="card grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormInput label="Age" type="number" min="1" max="120" required value={form.age} onChange={set('age')} />
          <FormInput label="Blood Pressure (Systolic)" type="number" placeholder="e.g. 120" value={form.blood_pressure_systolic} onChange={set('blood_pressure_systolic')} />
          <FormInput label="Blood Pressure (Diastolic)" type="number" placeholder="e.g. 80" value={form.blood_pressure_diastolic} onChange={set('blood_pressure_diastolic')} />
          <FormInput label="Glucose Level (mg/dL)" type="number" placeholder="e.g. 100" value={form.glucose_level} onChange={set('glucose_level')} />
          <FormInput label="Cholesterol (mg/dL)" type="number" placeholder="e.g. 200" value={form.cholesterol} onChange={set('cholesterol')} />

          <div className="sm:col-span-2 grid grid-cols-2 gap-3 pt-2">
            {[
              { k: 'smoking', label: 'I smoke' },
              { k: 'exercise', label: 'I exercise regularly' },
              { k: 'family_history_diabetes', label: 'Family history of diabetes' },
              { k: 'family_history_heart', label: 'Family history of heart disease' },
            ].map((t) => (
              <button
                type="button"
                key={t.k}
                onClick={toggle(t.k)}
                className={`px-4 py-2.5 rounded-xl text-sm border-2 text-left transition ${
                  form[t.k]
                    ? 'border-primary-500 bg-primary-50 text-primary-600 font-medium'
                    : 'border-gray-200 text-gray-500 hover:border-primary-300'
                }`}
              >
                {form[t.k] ? '✓ ' : ''}{t.label}
              </button>
            ))}
          </div>

          <div className="sm:col-span-2 flex justify-end pt-2">
            <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">
              {submitting ? 'Computing…' : 'Generate Risk Report'}
            </button>
          </div>
        </form>
      </section>

      {/* History timeline ───────────────────────────────── */}
      <section>
        <h3 className="text-lg font-semibold text-primary-500 mb-3">History</h3>
        <div className="space-y-3">
          {history.loading ? (
            <div className="card text-sm text-gray-500">Loading…</div>
          ) : (history.data?.assessments || []).length === 0 ? (
            <div className="card text-sm text-gray-500">No previous assessments.</div>
          ) : (
            history.data.assessments.map((a) => (
              <div key={a.risk_id} className="card flex items-center justify-between gap-3">
                <div className="text-sm">
                  <div className="font-medium text-primary-500">
                    {a.assessed_at ? format(new Date(a.assessed_at), 'dd MMM yyyy, HH:mm') : '—'}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Diabetes {a.diabetes_risk ?? 0}% · Heart {a.heart_risk ?? 0}% · HTN {a.hypertension_risk ?? 0}%
                  </div>
                </div>
                <Badge status={a.risk_level} />
              </div>
            ))
          )}
        </div>
      </section>
    </DashboardLayout>
  );
};

export default RiskReport;
