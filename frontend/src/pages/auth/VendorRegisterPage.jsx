import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiMail, FiLock, FiBriefcase, FiUser, FiHash } from 'react-icons/fi';

import AuthShell from '../../components/auth/AuthShell';
import StepIndicator from '../../components/auth/StepIndicator';
import FormInput from '../../components/auth/FormInput';
import PasswordStrengthBar from '../../components/auth/PasswordStrengthBar';
import PhoneCounter from '../../components/auth/PhoneCounter';
import PhoneInput from '../../components/common/PhoneInput';
import { validators, scrollToFirstError } from '../../utils/validation';
import API from '../../api/axios';

const STEPS = ['Account', 'Company'];

const initial = {
  email: '', password: '', confirm: '',
  company_name: '', tax_id: '', contact_name: '', phone: '',
};

const VendorRegisterPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  // PhoneInput hands back the raw digit string (not an event).
  const setVal = (k) => (val) => setForm((p) => ({ ...p, [k]: val }));

  // Returns the errors object for the current step ({} when valid).
  const validateStep = () => {
    const e = {};
    if (step === 1) {
      e.email = validators.email(form.email);
      e.password = validators.password(form.password);
      e.confirm = validators.confirmPassword(form.confirm, form.password);
    } else {
      if (!form.company_name) e.company_name = 'Company name is required';
      if (!form.tax_id) e.tax_id = 'Tax ID / GST is required';
      else e.tax_id = validators.gst(form.tax_id);
      e.contact_name = validators.name(form.contact_name);
      if (form.phone) e.phone = validators.phone(form.phone);
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
    setStep(2);
  };
  const back = () => setStep(1);

  const submit = async (ev) => {
    ev.preventDefault();
    const e = validateStep();
    if (submitting || Object.keys(e).length) {
      if (Object.keys(e).length) {
        toast.error('Please fix the highlighted fields before continuing.');
        scrollToFirstError();
      }
      return;
    }
    setSubmitting(true);
    try {
      await API.post('/api/auth/register/vendor/', {
        email: form.email,
        password: form.password,
        company_name: form.company_name,
        tax_id: form.tax_id,
        contact_name: form.contact_name,
        phone: form.phone,
      });
      toast.success('Registration submitted! Awaiting Super Admin approval.');
      navigate('/login');
    } catch (err) {
      const data = err?.response?.data;
      if (data?.errors) setErrors(data.errors);
      toast.error(data?.message || 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Vendor Registration" subtitle="Register your medical equipment company">
      <StepIndicator steps={STEPS} current={step} />

      <form onSubmit={submit} className="space-y-4">
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <FormInput label="Business Email" type="email" icon={FiMail} value={form.email} onChange={set('email')} error={errors.email} required />
              <div>
                <FormInput label="Password" type="password" icon={FiLock} placeholder="At least 8 characters" value={form.password} onChange={set('password')} error={errors.password} required />
                <PasswordStrengthBar password={form.password} />
              </div>
              <FormInput label="Confirm Password" type="password" icon={FiLock} value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
            </motion.div>
          )}

          {step === 2 && (
            <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
              <FormInput label="Company Name" icon={FiBriefcase} value={form.company_name} onChange={set('company_name')} error={errors.company_name} required />
              <FormInput label="Tax ID (GST Number)" icon={FiHash} value={form.tax_id} onChange={set('tax_id')} error={errors.tax_id} required />
              <FormInput label="Contact Name" icon={FiUser} value={form.contact_name} onChange={set('contact_name')} error={errors.contact_name} required />
              <div>
                <PhoneInput label="Phone Number" name="phone" value={form.phone} onChange={setVal('phone')} error={errors.phone} placeholder="10-digit mobile" />
                <PhoneCounter phone={form.phone} />
              </div>
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-xl px-4 py-3 text-sm">
                Your account will be reviewed by Super Admin before activation.
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center justify-between gap-3 pt-4">
          {step > 1 ? <button type="button" onClick={back} className="btn-secondary">Back</button> : <span />}
          {step < STEPS.length ? (
            <button type="button" onClick={next} className="btn-primary">Continue</button>
          ) : (
            <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit Registration'}
            </button>
          )}
        </div>
      </form>
    </AuthShell>
  );
};

export default VendorRegisterPage;
