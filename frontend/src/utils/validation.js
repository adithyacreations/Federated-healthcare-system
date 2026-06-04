// Shared client-side validators for FederCare registration forms.
// Every validator returns `null` when valid, or an error string when invalid.

export const validators = {
  name: (value) => {
    if (!value?.trim()) return 'Full name is required';
    if (value.trim().length < 3) return 'Name must be at least 3 characters';
    if (value.trim().length > 100) return 'Name too long';
    if (!/^[a-zA-Z\s.'-]+$/.test(value)) {
      return "Name can only contain letters, spaces and . ' -";
    }
    return null;
  },

  email: (value) => {
    if (!value?.trim()) return 'Email is required';
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return 'Enter a valid email address';
    return null;
  },

  // Indian mobile number — 10 digits starting 6-9.
  phone: (value) => {
    if (!value?.trim()) return 'Phone number is required';
    const cleaned = value.replace(/^\+91/, '').replace(/\s/g, '');
    if (!/^[6-9]\d{9}$/.test(cleaned)) {
      return 'Enter valid 10-digit Indian mobile number (starting with 6-9)';
    }
    return null;
  },

  // Optional mobile number — empty is allowed, but if present it must be valid.
  phoneOptional: (value) => {
    if (!value?.trim()) return null;
    return validators.phone(value);
  },

  password: (value) => {
    if (!value) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    if (!/[A-Z]/.test(value)) return 'Password must have at least one uppercase letter';
    if (!/[a-z]/.test(value)) return 'Password must have at least one lowercase letter';
    if (!/[0-9]/.test(value)) return 'Password must have at least one number';
    return null;
  },

  confirmPassword: (value, password) => {
    if (!value) return 'Please confirm your password';
    if (value !== password) return 'Passwords do not match';
    return null;
  },

  dob: (value) => {
    if (!value) return 'Date of birth is required';
    const dob = new Date(value);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    if (dob > today) return 'Date of birth cannot be in the future';
    if (age < 1) return 'Invalid date of birth';
    if (age > 120) return 'Invalid date of birth';
    return null;
  },

  patientAge: (value) => {
    const dobError = validators.dob(value);
    if (dobError) return dobError;
    const dob = new Date(value);
    const today = new Date();
    const age = today.getFullYear() - dob.getFullYear();
    if (age < 1) return 'Patient must be at least 1 year old';
    if (age > 120) return 'Please check the date of birth';
    return null;
  },

  medicalLicense: (value) => {
    if (!value?.trim()) return 'Medical license number is required';
    if (value.trim().length < 5) return 'Enter a valid license number';
    return null;
  },

  // Generic license (pharmacy / lab) — same minimum length rule.
  license: (value) => {
    if (!value?.trim()) return 'License number is required';
    if (value.trim().length < 5) return 'Enter a valid license number';
    return null;
  },

  specialization: (value) => {
    if (!value?.trim()) return 'Specialization is required';
    return null;
  },

  experience: (value) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0) return 'Enter valid years of experience';
    if (num > 60) return 'Please check years of experience';
    return null;
  },

  pinCode: (value) => {
    if (!value?.trim()) return 'PIN code is required';
    if (!/^\d{6}$/.test(value)) return 'Enter valid 6-digit PIN code';
    return null;
  },

  vehicleNumber: (value) => {
    if (!value?.trim()) return 'Vehicle number is required';
    const vehicleRegex = /^[A-Z]{2}[-\s]?\d{2}[-\s]?[A-Z]{1,3}[-\s]?\d{4}$/i;
    if (!vehicleRegex.test(value.replace(/\s/g, ''))) {
      return 'Enter valid vehicle number (e.g. KL-01-AB-1234)';
    }
    return null;
  },

  // GST is optional — only validated when a value is present.
  gst: (value) => {
    if (!value?.trim()) return null;
    const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    if (!gstRegex.test(value.toUpperCase())) {
      return 'Enter valid GST number (e.g. 32ABCDE1234F1Z5)';
    }
    return null;
  },

  required: (value, label = 'This field') => {
    if (!value?.toString().trim()) return `${label} is required`;
    return null;
  },

  getPasswordStrength: (value) => {
    if (!value) return null;
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[A-Z]/.test(value)) score++;
    if (/[a-z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;

    if (score <= 2) return { level: 'Weak', color: '#EF4444', width: '33%' };
    if (score <= 4) return { level: 'Medium', color: '#F97316', width: '66%' };
    return { level: 'Strong', color: '#22C55E', width: '100%' };
  },
};

// After a failed step validation, smoothly scroll to (and focus) the first
// invalid control. FormInput marks invalid controls with `border-danger`;
// PhoneInput marks its input with `data-error="true"`. Deferred so the error
// classes have been painted by React before we query the DOM.
export function scrollToFirstError(delay = 60) {
  if (typeof document === 'undefined') return;
  setTimeout(() => {
    const el = document.querySelector('.border-danger, [data-error="true"]');
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function') {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
  }, delay);
}

export default validators;
