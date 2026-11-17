import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiMail, FiLock, FiUser, FiHome } from 'react-icons/fi';

import AuthShell from '../../components/auth/AuthShell';
import StepIndicator from '../../components/auth/StepIndicator';
import FormInput from '../../components/auth/FormInput';
import PasswordStrengthBar from '../../components/auth/PasswordStrengthBar';
import PhoneCounter from '../../components/auth/PhoneCounter';
import PhoneInput from '../../components/common/PhoneInput';
import { validators, scrollToFirstError } from '../../utils/validation';
import API from '../../api/axios';

const STEPS = ['Account', 'Personal', 'Health Info'];

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const HEIGHT_RANGE = { min: 40, max: 275 };
const WEIGHT_RANGE = { min: 2, max: 650 };
const MAX_STORED_BMI = 99.99;
const DOB_YEAR_ERROR = 'Enter a four-digit birth year.';

const measurementError = (value, { min, max }, unit) => {
  if (value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    return `Enter a value between ${min} and ${max} ${unit}.`;
  }
  return null;
};

const initial = {
  email: '', password: '', confirm: '',
  full_name: '', dob: '', gender: '', blood_group: '', phone: '',
  height_cm: '', weight_kg: '', address: '', emergency_contact: '',
};

const PatientRegisterPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  // PhoneInput hands back the raw digit string (not an event).
  const setVal = (k) => (val) => setForm((p) => ({ ...p, [k]: val }));
  const setDob = ({ target: { value } }) => {
    const invalidYear = value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value);
    setVal('dob')(invalidYear ? '' : value);
    setErrors((previous) => ({ ...previous, dob: invalidYear ? DOB_YEAR_ERROR : null }));
  };

  const bmi = useMemo(() => {
    const { height_cm, weight_kg } = form;
    if (!height_cm || !weight_kg
        || measurementError(height_cm, HEIGHT_RANGE, 'cm')
        || measurementError(weight_kg, WEIGHT_RANGE, 'kg')) return null;
    const result = (Number(weight_kg) / (Number(height_cm) / 100) ** 2).toFixed(2);
    return Number(result) <= MAX_STORED_BMI ? result : null;
  }, [form.height_cm, form.weight_kg]);

  // Returns the errors object for the current step ({} when valid).
  const validateStep = () => {
    const e = {};
    if (step === 1) {
      e.email = validators.email(form.email);
      e.password = validators.password(form.password);
      e.confirm = validators.confirmPassword(form.confirm, form.password);
    } else if (step === 2) {
      e.full_name = validators.name(form.full_name);
      e.dob = errors.dob === DOB_YEAR_ERROR ? DOB_YEAR_ERROR : validators.patientAge(form.dob);
      e.phone = validators.phone(form.phone);
    } else if (step === 3) {
      e.height_cm = measurementError(form.height_cm, HEIGHT_RANGE, 'cm');
      e.weight_kg = measurementError(form.weight_kg, WEIGHT_RANGE, 'kg');
      // Emergency contact is optional, but must be a valid mobile if entered.
      e.emergency_contact = validators.phoneOptional(form.emergency_contact);
    }
    Object.keys(e).forEach((k) => e[k] == null && delete e[k]);
    setErrors(e);
    return e;
  };

  const next = () => {
    const e = validateStep();
    if (Object.keys(e).length) {
      toast.error('Please fix the highlighted fields before continuing.');
      scrollToFirstError();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length));
  };
  const back = () => setStep((s) => Math.max(s - 1, 1));

  const register = async ({ currentTarget }) => {
    if (step !== STEPS.length || submitting) return;

    const e = validateStep();
    if (Object.keys(e).length) {
      toast.error('Please fix the highlighted fields before continuing.');
      scrollToFirstError();
      return;
    }
    if (!currentTarget.form.reportValidity()) return;
    setSubmitting(true);
    try {
      const payload = {
        email: form.email,
        password: form.password,
        full_name: form.full_name,
        dob: form.dob,
        gender: form.gender,
        blood_group: form.blood_group,
        phone: form.phone,
        height_cm: form.height_cm || null,
        weight_kg: form.weight_kg || null,
        address: form.address,
        emergency_contact: form.emergency_contact,
      };
      const { data } = await API.post('/api/auth/register/patient/', payload);
      const d = data?.data || {};
      // No auto-login — show the success screen, then send them to log in.
      setRegisteredEmail(d.email || form.email);
      setRegistrationComplete(true);
      setTimeout(() => navigate('/login'), 5000);
    } catch (err) {
      const data = err?.response?.data;
      if (data?.errors) setErrors(data.errors);
      toast.error(data?.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (registrationComplete) {
    return (
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: '#FAF7F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px',
        }}
      >
        <div
          style={{
            backgroundColor: 'white',
            borderRadius: '24px',
            padding: '48px 40px',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          }}
        >
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: '#F0FDF4',
              border: '3px solid #22C55E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
              fontSize: '36px',
            }}
          >
            ✅
          </div>

          <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#000', margin: '0 0 12px' }}>
            Registration Successful!
          </h2>

          <p style={{ color: '#666', fontSize: '15px', lineHeight: 1.6, margin: '0 0 24px' }}>
            Welcome to FederCare! 🎉
            <br />
            Your account has been created. Please login with your credentials.
          </p>

          <div
            style={{
              backgroundColor: '#FFF7ED',
              borderRadius: '12px',
              padding: '16px',
              marginBottom: '24px',
              border: '1px solid #FED7AA',
              textAlign: 'left',
            }}
          >
            <p style={{ fontSize: '12px', fontWeight: 700, color: '#F97316', marginBottom: '8px' }}>
              📋 Your Login Details:
            </p>
            <p style={{ fontSize: '14px', color: '#333', margin: '0 0 4px' }}>
              📧 Email: <b>{registeredEmail}</b>
            </p>
            <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
              🔑 Password: The one you just set
            </p>
          </div>

          <p style={{ color: '#9CA3AF', fontSize: '13px', marginBottom: '20px' }}>
            Redirecting to login in 5 seconds...
          </p>

          <button
            onClick={() => navigate('/login')}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#F97316',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Go to Login →
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthShell title="Patient Registration" subtitle="Create your FederCare patient account">
      <StepIndicator steps={STEPS} current={step} />

      <form onSubmit={(event) => event.preventDefault()} className="space-y-4">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <FormInput label="Email" type="email" icon={FiMail} placeholder="you@example.com"
                value={form.email} onChange={set('email')} error={errors.email} required />
              <div>
                <FormInput label="Password" type="password" icon={FiLock} placeholder="At least 8 characters"
                  value={form.password} onChange={set('password')} error={errors.password} required />
                <PasswordStrengthBar password={form.password} />
              </div>
              <FormInput label="Confirm Password" type="password" icon={FiLock}
                value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <FormInput label="Full Name" icon={FiUser} placeholder="Your full name"
                value={form.full_name} onChange={set('full_name')} error={errors.full_name} required />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Date of Birth" type="date" max="9999-12-31"
                  value={form.dob} onChange={setDob} error={errors.dob} required />
                <FormInput label="Gender" as="select" value={form.gender} onChange={set('gender')}
                  options={[
                    { value: '', label: 'Select…' },
                    { value: 'male', label: 'Male' },
                    { value: 'female', label: 'Female' },
                    { value: 'other', label: 'Other' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Blood Group" as="select" value={form.blood_group} onChange={set('blood_group')}
                  options={[{ value: '', label: 'Select…' }, ...BLOOD_GROUPS.map((g) => ({ value: g, label: g }))]}
                />
                <div>
                  <PhoneInput label="Phone" name="phone" value={form.phone} onChange={setVal('phone')}
                    error={errors.phone} placeholder="10-digit mobile" required />
                  <PhoneCounter phone={form.phone} />
                </div>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormInput label="Height (cm)" type="number" step="0.01" {...HEIGHT_RANGE}
                  hint="40–275 cm (optional)" value={form.height_cm} onChange={set('height_cm')} error={errors.height_cm} />
                <FormInput label="Weight (kg)" type="number" step="0.01" {...WEIGHT_RANGE}
                  hint="2–650 kg (optional)" value={form.weight_kg} onChange={set('weight_kg')} error={errors.weight_kg} />
              </div>
              {bmi && (
                <div className="bg-orange-50 border border-orange-100 rounded-xl px-4 py-3 text-sm text-orange-600">
                  <span className="font-medium">Auto-calculated BMI:</span> {bmi}
                </div>
              )}
              <FormInput label="Address" as="textarea" icon={FiHome} value={form.address} onChange={set('address')} />
              <PhoneInput label="Emergency Contact Number" name="emergency_contact"
                value={form.emergency_contact} onChange={setVal('emergency_contact')}
                error={errors.emergency_contact} placeholder="Emergency mobile number" />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between gap-3 pt-4">
          {step > 1 ? (
            <button type="button" onClick={back} className="btn-secondary">Back</button>
          ) : <span />}
          {step < STEPS.length ? (
            <button key="continue" type="button" onClick={next} className="btn-primary">Continue</button>
          ) : (
            <button key="register" type="button" onClick={register} disabled={submitting} className="btn-primary disabled:opacity-60">
              {submitting ? 'Registering…' : 'Register'}
            </button>
          )}
        </div>
      </form>
    </AuthShell>
  );
};

export default PatientRegisterPage;
