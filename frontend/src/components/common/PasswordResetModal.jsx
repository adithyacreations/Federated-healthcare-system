import { useState, useRef } from 'react';
import toast from 'react-hot-toast';
import API from '../../api/axios';

const ORANGE = '#F97316';

/* Reusable OTP-verified password reset modal.
 * Works in two modes:
 *   - isAuthenticated=false → login page. Sends OTP to a typed email,
 *     resets via /password-reset/send-otp/ + /password-reset/verify/.
 *   - isAuthenticated=true  → dashboards. OTP goes to the logged-in user's
 *     email, resets via /password-reset/authenticated/ (action-based). */
export default function PasswordResetModal({
  isOpen,
  onClose,
  email: prefilledEmail = '',
  isAuthenticated = false,
  // Profile "change password" needs the current password; the login
  // "forgot password" flow must NOT (the user has forgotten it). Defaults to
  // isAuthenticated so existing call sites keep their correct behaviour.
  requireCurrentPassword = isAuthenticated,
}) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(prefilledEmail);
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);

  const otpRefs = useRef([]);

  const resetModal = () => {
    setStep(1);
    setOtpDigits(Array(6).fill(''));
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setLoading(false);
  };

  const handleClose = () => {
    resetModal();
    onClose();
  };

  // ── Step 1 — send OTP ─────────────────────────────────────────────────────
  const handleSendOTP = async () => {
    if (!isAuthenticated && !email) {
      toast.error('Email required!');
      return;
    }
    try {
      setLoading(true);
      const endpoint = isAuthenticated
        ? '/api/auth/password-reset/authenticated/'
        : '/api/auth/password-reset/send-otp/';
      const payload = isAuthenticated ? { action: 'send_otp' } : { email };

      const response = await API.post(endpoint, payload);
      if (response.data.success) {
        toast.success(response.data.message || 'OTP sent!');
        setOtpDigits(Array(6).fill(''));
        setStep(2);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to send OTP!');
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2 — OTP digit handling ───────────────────────────────────────────
  const handleOTPDigit = (value, index) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value;
    setOtpDigits(newDigits);

    if (value && index < 5) otpRefs.current[index + 1]?.focus();
    if (index === 5 && value && newDigits.join('').length === 6) setStep(3);
  };

  // ── Step 3 — reset password ───────────────────────────────────────────────
  const handleResetPassword = async () => {
    const otp = otpDigits.join('');
    if (otp.length !== 6) {
      toast.error('Enter complete OTP!');
      return;
    }
    if (requireCurrentPassword && !currentPassword) {
      toast.error('Current password required!');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be 8+ chars!');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match!');
      return;
    }
    if (requireCurrentPassword && newPassword === currentPassword) {
      toast.error('New password must be different!');
      return;
    }

    try {
      setLoading(true);
      const endpoint = isAuthenticated
        ? '/api/auth/password-reset/authenticated/'
        : '/api/auth/password-reset/verify/';
      const payload = isAuthenticated
        ? { action: 'verify_and_reset', otp, new_password: newPassword }
        : { email, otp, new_password: newPassword };
      if (requireCurrentPassword) payload.current_password = currentPassword;

      const response = await API.post(endpoint, payload);
      if (response.data.success) {
        toast.success(response.data.message || 'Password changed!');
        handleClose();
        if (!isAuthenticated) {
          setTimeout(() => {
            window.location.href = '/login';
          }, 1500);
        }
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Reset failed!');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <div>
            <h3 className="font-bold text-xl text-black">Reset Password</h3>
            <div className="flex items-center gap-1 mt-2">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className="h-1 w-8 rounded-full transition-all"
                  style={{ backgroundColor: step >= s ? ORANGE : '#E5E5E5' }}
                />
              ))}
              <span className="text-xs text-gray-400 ml-2">Step {step} of 3</span>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Step 1 — email + send OTP */}
          {step === 1 && (
            <div>
              <p className="text-gray-500 text-sm mb-4">
                We'll send a 6-digit OTP to your registered Gmail.
              </p>

              {!isAuthenticated && (
                <div className="mb-4">
                  <label className="text-sm font-medium text-black mb-1 block">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
                  />
                </div>
              )}

              {isAuthenticated && (
                <div className="bg-orange-50 rounded-xl p-3 mb-4">
                  <p className="text-sm text-orange-700">
                    OTP will be sent to: <b className="ml-1">{prefilledEmail}</b>
                  </p>
                </div>
              )}

              <button
                onClick={handleSendOTP}
                disabled={loading || (!isAuthenticated && !email)}
                className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: ORANGE }}
              >
                {loading ? 'Sending OTP...' : '📧 Send OTP to Gmail'}
              </button>
            </div>
          )}

          {/* Step 2 — enter OTP */}
          {step === 2 && (
            <div>
              <p className="text-gray-500 text-sm mb-6 text-center">
                Enter the 6-digit OTP sent to your Gmail
              </p>

              <div className="flex justify-center gap-2 mb-4">
                {otpDigits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      otpRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOTPDigit(e.target.value, i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !digit && i > 0) {
                        otpRefs.current[i - 1]?.focus();
                      }
                    }}
                    style={{
                      width: '48px',
                      height: '56px',
                      textAlign: 'center',
                      fontSize: '24px',
                      fontWeight: '700',
                      border: `2px solid ${digit ? ORANGE : '#E5E5E5'}`,
                      borderRadius: '12px',
                      outline: 'none',
                      transition: 'all 0.2s',
                    }}
                  />
                ))}
              </div>

              <p className="text-center text-xs text-gray-400 mb-4">
                ⏱️ OTP valid for 10 minutes
              </p>

              <button
                onClick={() => {
                  if (otpDigits.join('').length === 6) setStep(3);
                  else toast.error('Enter all 6 digits!');
                }}
                className="w-full py-3 rounded-full font-semibold text-white mb-3"
                style={{ backgroundColor: ORANGE }}
              >
                Verify OTP →
              </button>

              <p className="text-center text-sm text-gray-500">
                Didn't receive?{' '}
                <button
                  onClick={() => {
                    setOtpDigits(Array(6).fill(''));
                    handleSendOTP();
                  }}
                  style={{ color: ORANGE }}
                  className="font-medium underline"
                >
                  Resend OTP
                </button>
              </p>
            </div>
          )}

          {/* Step 3 — new password */}
          {step === 3 && (
            <div className="space-y-4">
              <p className="text-gray-500 text-sm">
                ✅ OTP entered! Now set your new password.
              </p>

              {/* Current password — skipped for the forgot-password flow */}
              {requireCurrentPassword && (
                <div>
                  <label className="text-sm font-medium text-black mb-1 block">
                    Current Password
                  </label>
                  <div className="relative">
                    <input
                      type={showCurrentPwd ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm pr-12 focus:outline-none focus:border-orange-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPwd(!showCurrentPwd)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg"
                    >
                      {showCurrentPwd ? '🙈' : '👁️'}
                    </button>
                  </div>
                </div>
              )}

              {/* New password */}
              <div>
                <label className="text-sm font-medium text-black mb-1 block">
                  New Password
                </label>
                <div className="relative">
                  <input
                    type={showNewPwd ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm pr-12 focus:outline-none focus:border-orange-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPwd(!showNewPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-lg"
                  >
                    {showNewPwd ? '🙈' : '👁️'}
                  </button>
                </div>
                {newPassword && (
                  <div className="flex gap-1 mt-2">
                    {[
                      newPassword.length >= 8,
                      /[A-Z]/.test(newPassword),
                      /[0-9]/.test(newPassword),
                      /[^A-Za-z0-9]/.test(newPassword),
                    ].map((met, i) => (
                      <div
                        key={i}
                        className="flex-1 h-1 rounded-full transition-all"
                        style={{ backgroundColor: met ? ORANGE : '#E5E5E5' }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm password */}
              <div>
                <label className="text-sm font-medium text-black mb-1 block">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none ${
                    confirmPassword && newPassword !== confirmPassword
                      ? 'border-red-400'
                      : 'border-gray-200 focus:border-orange-400'
                  }`}
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-red-500 text-xs mt-1">Passwords do not match!</p>
                )}
                {confirmPassword && newPassword && newPassword === confirmPassword && (
                  <p className="text-xs mt-1" style={{ color: ORANGE }}>
                    ✅ Passwords match!
                  </p>
                )}
              </div>

              <button
                onClick={handleResetPassword}
                disabled={
                  loading ||
                  (requireCurrentPassword && !currentPassword) ||
                  newPassword.length < 8 ||
                  newPassword !== confirmPassword
                }
                className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: ORANGE }}
              >
                {loading ? 'Changing Password...' : '🔐 Change Password'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
