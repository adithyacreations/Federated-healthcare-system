import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

import API, { removeAuthToken } from '../../api/axios';

// Strength meter — purely visual; the real policy is enforced by the backend.
const getStrength = (pass) => {
  if (!pass) return null;
  let score = 0;
  if (pass.length >= 8) score++;
  if (pass.length >= 12) score++;
  if (/[A-Z]/.test(pass)) score++;
  if (/[a-z]/.test(pass)) score++;
  if (/[0-9]/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  if (score <= 2) return { level: 'Weak', color: '#EF4444', width: '33%' };
  if (score <= 4) return { level: 'Medium', color: '#F97316', width: '66%' };
  return { level: 'Strong', color: '#22C55E', width: '100%' };
};

export default function ChangeFirstPasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    setError('');
    if (!newPassword || !confirmPassword) {
      setError('Please fill all fields!');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match!');
      return;
    }
    if (newPassword.length < 8) {
      setError('Minimum 8 characters!');
      return;
    }

    try {
      setLoading(true);
      const response = await API.post('/api/auth/change-first-password/', {
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      if (response.data?.success) {
        // Force a clean re-login with the new password.
        removeAuthToken();
        toast.success('Password changed! Please log in.');
        navigate('/login');
      } else {
        setError(response.data?.message || 'Failed! Please try again.');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed! Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const strength = getStrength(newPassword);
  const canSubmit = newPassword && newPassword === confirmPassword && !loading;

  const requirements = [
    { check: newPassword.length >= 8, text: 'At least 8 characters' },
    { check: /[A-Z]/.test(newPassword), text: 'One uppercase letter' },
    { check: /[a-z]/.test(newPassword), text: 'One lowercase letter' },
    { check: /[0-9]/.test(newPassword), text: 'One number' },
  ];

  const inputBase = {
    width: '100%', padding: '12px 16px', border: '1.5px solid #E5E5E5',
    borderRadius: 12, fontSize: 14, outline: 'none', boxSizing: 'border-box',
  };
  const labelBase = {
    display: 'block', fontSize: 13, fontWeight: 600, color: '#333', marginBottom: 6,
  };

  return (
    <div
      style={{
        minHeight: '100vh', backgroundColor: '#FAF7F2', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        style={{
          backgroundColor: 'white', borderRadius: 24, padding: 40,
          maxWidth: 440, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 16, backgroundColor: '#F97316',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', fontSize: 24, color: 'white', fontWeight: 900,
          }}
        >
          F
        </div>

        <h2 style={{ textAlign: 'center', fontWeight: 800, fontSize: 22, margin: '0 0 8px' }}>
          🔑 Set Your Password
        </h2>
        <p style={{ textAlign: 'center', color: '#666', fontSize: 14, margin: '0 0 28px', lineHeight: 1.5 }}>
          Welcome to FederCare! Please create a new password to secure your account.
        </p>

        <div
          style={{
            backgroundColor: '#FFF7ED', borderRadius: 10, padding: '12px 16px',
            marginBottom: 20, border: '1px solid #FED7AA',
          }}
        >
          <p style={{ fontSize: 12, color: '#F97316', margin: 0, fontWeight: 600 }}>
            ⚠️ You are using a temporary password. Please set a new password to continue.
          </p>
        </div>

        {/* New password */}
        <div style={{ marginBottom: 16 }}>
          <label style={labelBase}>New Password *</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Create strong password"
            style={inputBase}
          />
          {strength && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 4, backgroundColor: '#E5E5E5', borderRadius: 999, overflow: 'hidden' }}>
                <div
                  style={{
                    width: strength.width, height: '100%', backgroundColor: strength.color,
                    borderRadius: 999, transition: 'width 0.3s',
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: strength.color, marginTop: 4, fontWeight: 600 }}>
                {strength.level} Password
              </p>
            </div>
          )}
        </div>

        {/* Confirm password */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelBase}>Confirm Password *</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your password"
            style={{
              ...inputBase,
              border: `1.5px solid ${
                confirmPassword && confirmPassword !== newPassword ? '#EF4444' : '#E5E5E5'
              }`,
            }}
          />
          {confirmPassword && confirmPassword !== newPassword && (
            <p style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>⚠️ Passwords do not match!</p>
          )}
          {confirmPassword && confirmPassword === newPassword && (
            <p style={{ fontSize: 12, color: '#22C55E', marginTop: 4 }}>✅ Passwords match!</p>
          )}
        </div>

        {/* Requirements */}
        <div style={{ backgroundColor: '#F9FAFB', borderRadius: 10, padding: 12, marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#666', margin: '0 0 6px' }}>
            Password must have:
          </p>
          {requirements.map((req, i) => (
            <p key={i} style={{ fontSize: 12, color: req.check ? '#22C55E' : '#9CA3AF', margin: '2px 0' }}>
              {req.check ? '✅' : '○'} {req.text}
            </p>
          ))}
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#FEF2F2', borderRadius: 10, padding: '10px 14px',
              marginBottom: 16, border: '1px solid #FCA5A5',
            }}
          >
            <p style={{ color: '#EF4444', fontSize: 13, margin: 0 }}>⚠️ {error}</p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            width: '100%', padding: 14,
            backgroundColor: canSubmit ? '#F97316' : '#E5E5E5',
            color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 16,
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {loading ? '⏳ Saving...' : '🔑 Set New Password'}
        </button>
      </div>
    </div>
  );
}
