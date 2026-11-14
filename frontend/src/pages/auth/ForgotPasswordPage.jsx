import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ResetCodeInput from '../../components/auth/ResetCodeInput';
import toast from 'react-hot-toast';
import API from '../../api/axios';

const ORANGE = '#F97316';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const requestOTP = async () => {
    if (!email) return;
    try {
      setLoading(true);
      const response = await API.post('/api/auth/password-reset/request/', { email });
      if (response.data.success) {
        toast.success(response.data.message || 'If this email is registered, you should receive a reset code.');
        setOtp('');
        setStep(2);
      }
    } catch {
      toast.error('Failed to send OTP!');
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) return;
    try {
      setLoading(true);
      const response = await API.post('/api/auth/password-reset/verify/', {
        email,
        otp,
        new_password: newPassword,
      });
      if (response.data.success) {
        toast.success('Password reset!');
        navigate('/login');
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Reset failed!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4" style={{ backgroundColor: '#FAF7F2' }}>
      <div className="bg-white rounded-2xl p-4 sm:p-8 w-full max-w-md shadow-lg">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
            style={{ backgroundColor: ORANGE }}
          >
            F
          </div>
          <span className="font-bold text-xl">FederCare</span>
        </div>

        {/* Step 1 — Email */}
        {step === 1 && (
          <>
            <h2 className="font-bold text-2xl mb-2 text-black">Reset Password</h2>
            <p className="text-gray-500 text-sm mb-6">Enter your email to receive a 6-digit OTP</p>
            <input
              type="email"
              aria-label="Email address"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full border border-gray-200 rounded-xl p-3 text-base mb-4 focus:outline-none focus:border-orange-400"
            />
            <button
              onClick={requestOTP}
              disabled={!email || loading}
              className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: ORANGE }}
            >
              {loading ? 'Sending OTP...' : 'Send OTP to Email'}
            </button>
          </>
        )}

        {/* Step 2 — OTP */}
        {step === 2 && (
          <>
            <h2 className="font-bold text-2xl mb-2 text-black">Enter OTP</h2>
            <p className="text-gray-500 text-sm mb-6">
              If <b className="break-all">{email}</b> is registered, check its inbox or spam folder for a 6-digit code.
            </p>

            <ResetCodeInput value={otp} onChange={setOtp} />
            <button
              onClick={() => setStep(3)}
              disabled={otp.length !== 6 || loading}
              className="mb-3 w-full rounded-full py-3 font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: ORANGE }}
            >
              Continue
            </button>

            <p className="text-center text-sm text-gray-500 mb-4">
              Didn't receive?{' '}
              <button onClick={requestOTP} disabled={loading} className="min-h-[44px] font-medium underline disabled:opacity-50" style={{ color: ORANGE }}>
                Resend OTP
              </button>
            </p>
          </>
        )}

        {/* Step 3 — New password */}
        {step === 3 && (
          <>
            <h2 className="font-bold text-2xl mb-2 text-black">New Password</h2>
            <p className="text-gray-500 text-sm mb-2">Create a strong new password</p>
            <button type="button" onClick={() => setStep(2)} disabled={loading} className="min-h-[44px] text-sm font-medium text-orange-700">Edit reset code</button>

            <input
              type="password"
              aria-label="New password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              className="w-full border border-gray-200 rounded-xl p-3 text-base mb-3 focus:outline-none focus:border-orange-400"
            />
            <input
              type="password"
              aria-label="Confirm password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm password"
              className="w-full border border-gray-200 rounded-xl p-3 text-base mb-4 focus:outline-none focus:border-orange-400"
            />

            {newPassword && confirmPassword && newPassword !== confirmPassword && (
              <p className="text-red-500 text-xs mb-3">Passwords do not match!</p>
            )}

            <button
              onClick={resetPassword}
              disabled={!newPassword || newPassword !== confirmPassword || loading}
              className="w-full py-3 rounded-full font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: ORANGE }}
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
          </>
        )}

        {/* Back to login */}
        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="font-medium hover:underline" style={{ color: ORANGE }}>
            ← Back to Login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
