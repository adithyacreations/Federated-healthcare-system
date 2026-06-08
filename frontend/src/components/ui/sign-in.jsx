import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiEye, FiEyeOff } from 'react-icons/fi';
import { useAuth } from '../../context/AuthContext';
import PasswordResetModal from '../common/PasswordResetModal';

/* FederCare brand tokens (match landing page) */
const CREAM = '#fff6ec';
const ORANGE = '#ff4f01';
const BLACK = '#101010';
const HEAD_FONT = '"Bricolage Grotesque", sans-serif';
const BODY_FONT = '"Manrope", sans-serif';

const ROLE_HOME = {
  super_admin: '/admin',
  hospital_admin: '/hospital',
  doctor: '/doctor',
  patient: '/patient',
  pharmacist: '/pharmacist',
  lab_tech: '/lab',
  driver: '/driver',
  vendor: '/vendor',
};

/* Verified medical stock images (Unsplash) */
const IMAGES = {
  telemedicine: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=800&auto=format&fit=crop&q=80',
  lab: 'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?w=800&auto=format&fit=crop&q=80',
  scan: 'https://images.unsplash.com/photo-1584515933487-779824d29309?w=800&auto=format&fit=crop&q=80',
  team: 'https://images.unsplash.com/photo-1505751172876-fa1923c5c528?w=800&auto=format&fit=crop&q=80',
};

const AnimatedSignIn = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [formVisible, setFormVisible] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => setFormVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  // Auth flow unchanged — routed through AuthContext.login (token storage +
  // role resolution live there). Only the UI is new.
  const handleSignIn = async (e) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    setIsLoading(true);
    try {
      const res = await login(email, password);
      if (res?.success) {
        // Staff added by a hospital admin log in with a temporary password and
        // must set their own before reaching their dashboard.
        if (res.force_password_change) {
          toast('Please set a new password to continue', { icon: '🔑' });
          navigate('/change-password');
        } else {
          toast.success('Welcome to FederCare!');
          navigate(ROLE_HOME[res.role] || '/dashboard');
        }
      } else {
        setError(res?.message || 'Login failed');
      }
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.detail ||
          'Invalid email or password'
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (!mounted) return null;

  const statTileStyle = (delay) => ({
    transform: formVisible ? 'translateY(0)' : 'translateY(20px)',
    opacity: formVisible ? 1 : 0,
    transition: 'transform 0.6s ease-out, opacity 0.6s ease-out',
    transitionDelay: delay,
  });

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: CREAM, fontFamily: BODY_FONT }}>
      <div className="flex min-h-screen items-center justify-center p-4 md:p-6">
        <div
          className="w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-xl shadow-gray-200 transition-all duration-500"
          style={{
            opacity: formVisible ? 1 : 0,
            transform: formVisible ? 'scale(1)' : 'scale(0.95)',
          }}
        >
          <div className="flex flex-col md:flex-row">
            {/* Left — medical image + stat collage */}
            <div className="hidden md:block w-full md:w-3/5 p-6" style={{ backgroundColor: CREAM }}>
              <div className="grid grid-cols-2 grid-rows-3 gap-4 h-full overflow-hidden">
                {/* Top left — telemedicine */}
                <div className="overflow-hidden rounded-xl">
                  <img src={IMAGES.telemedicine} alt="Doctor on a telemedicine consultation" className="w-full h-full object-cover" style={{ opacity: 0.95 }} />
                </div>

                {/* Top right — orange stat */}
                <div
                  className="rounded-xl flex flex-col justify-center items-center p-6 text-white"
                  style={{ backgroundColor: ORANGE, ...statTileStyle('0.2s') }}
                >
                  <h2 className="text-5xl font-bold mb-2" style={{ fontFamily: HEAD_FONT }}>95.5%</h2>
                  <p className="text-center text-sm">global model accuracy reached after federated training rounds.</p>
                </div>

                {/* Middle left — lab */}
                <div className="overflow-hidden rounded-xl">
                  <img src={IMAGES.lab} alt="Laboratory diagnostics" className="w-full h-full object-cover" style={{ opacity: 0.95 }} />
                </div>

                {/* Middle right — scan/imaging */}
                <div className="overflow-hidden rounded-xl">
                  <img src={IMAGES.scan} alt="Medical imaging scan" className="w-full h-full object-cover" style={{ opacity: 0.95 }} />
                </div>

                {/* Bottom left — black stat */}
                <div
                  className="rounded-xl flex flex-col justify-center items-center p-6 text-white"
                  style={{ backgroundColor: BLACK, ...statTileStyle('0.4s') }}
                >
                  <h2 className="text-5xl font-bold mb-2" style={{ fontFamily: HEAD_FONT }}>100%</h2>
                  <p className="text-center text-sm">patient data stays inside each hospital — only encrypted model weights are shared.</p>
                </div>

                {/* Bottom right — care team */}
                <div className="overflow-hidden rounded-xl">
                  <img src={IMAGES.team} alt="Hospital care team" className="w-full h-full object-cover" style={{ opacity: 0.95 }} />
                </div>
              </div>
            </div>

            {/* Right — sign-in form */}
            <div
              className="w-full md:w-2/5 p-8 md:p-12 bg-white text-gray-900"
              style={{
                transform: formVisible ? 'translateX(0)' : 'translateX(20px)',
                opacity: formVisible ? 1 : 0,
                transition: 'transform 0.6s ease-out, opacity 0.6s ease-out',
              }}
            >
              <div className="flex justify-start mb-6">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-2.5 text-sm font-semibold transition-colors hover:border-gray-400"
                  style={{ borderColor: '#E5E5E5', color: '#333333' }}
                >
                  ← Home
                </Link>
              </div>

              <div className="mb-8">
                <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: HEAD_FONT, color: BLACK }}>
                  Sign in to Feder<span style={{ color: ORANGE }}>Care</span>
                </h1>
                <p className="text-sm text-gray-600">
                  Welcome back — enter your login details to access your dashboard.
                </p>
              </div>

              <form onSubmit={handleSignIn} className="space-y-6">
                <div className="space-y-1">
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email Address</label>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    className="block w-full rounded-md border border-gray-300 bg-white py-3 px-4 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 sm:text-sm"
                    style={{ '--tw-ring-color': ORANGE }}
                    onFocus={(e) => { e.target.style.borderColor = ORANGE; }}
                    onBlur={(e) => { e.target.style.borderColor = '#d1d5db'; }}
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      name="password"
                      id="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="block w-full rounded-md border border-gray-300 bg-white py-3 px-4 pr-10 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 sm:text-sm"
                      style={{ '--tw-ring-color': ORANGE }}
                      onFocus={(e) => { e.target.style.borderColor = ORANGE; }}
                      onBlur={(e) => { e.target.style.borderColor = '#d1d5db'; }}
                      placeholder="••••••••"
                      required
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <FiEyeOff size={18} className="hover:text-gray-700 transition-colors" />
                      ) : (
                        <FiEye size={18} className="hover:text-gray-700 transition-colors" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    className="text-sm font-medium hover:underline"
                    style={{ color: ORANGE }}
                  >
                    Forgot the password?
                  </button>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-md px-4 py-2.5">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className={`flex w-full justify-center rounded-md py-3 px-4 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:opacity-90 ${
                    isLoading ? 'cursor-not-allowed opacity-70' : ''
                  }`}
                  style={{ backgroundColor: ORANGE }}
                >
                  {isLoading ? (
                    <span className="flex items-center">
                      <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Signing in...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center">Login</span>
                  )}
                </button>

                {/* Role registration links (replaces the demo social sign-in) */}
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-gray-300" />
                  <span className="flex-shrink mx-4 text-sm text-gray-500">New here?</span>
                  <div className="flex-grow border-t border-gray-300" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-center text-sm">
                  <Link to="/register/patient" className="py-1 hover:underline font-medium" style={{ color: ORANGE }}>Patient</Link>
                  <Link to="/register/hospital" className="py-1 hover:underline font-medium" style={{ color: ORANGE }}>Hospital</Link>
                  <Link to="/register/pharmacist" className="py-1 hover:underline font-medium" style={{ color: ORANGE }}>Pharmacy</Link>
                  <Link to="/register/vendor" className="py-1 hover:underline font-medium" style={{ color: ORANGE }}>Vendor</Link>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <PasswordResetModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        email={email}
        isAuthenticated={false}
        requireCurrentPassword={false}
      />
    </div>
  );
};

export { AnimatedSignIn };
