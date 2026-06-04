import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const AuthShell = ({ title, subtitle, children, footer }) => (
  <div className="min-h-screen bg-cream flex items-center justify-center px-4 py-10">
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="bg-white rounded-3xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] border border-hairline p-8 sm:p-10 w-full max-w-2xl"
    >
      <div className="text-center mb-8">
        <Link to="/" className="inline-flex flex-col items-center gap-3">
          <span className="w-14 h-14 rounded-2xl bg-orange-500 text-white flex items-center justify-center text-2xl font-black shadow-md">
            F
          </span>
          <span className="text-xl font-bold text-ink font-bricolage">
            Feder<span className="text-orange-500">Care</span>
          </span>
        </Link>
        <h1 className="text-2xl font-extrabold text-ink mt-4 font-bricolage">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {children}
      {footer || (
        <div className="text-center mt-6">
          <Link
            to="/"
            className="inline-flex items-center gap-1 text-sm font-semibold text-orange-500 hover:underline"
          >
            ← Back to Home
          </Link>
        </div>
      )}
    </motion.div>
  </div>
);

export default AuthShell;
