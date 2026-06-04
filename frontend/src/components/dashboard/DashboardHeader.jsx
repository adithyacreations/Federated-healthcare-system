import { motion } from 'framer-motion';
import { cardVariants } from './variants';

/**
 * DashboardHeader — large Bricolage title + grey subtitle, with an optional
 * right-aligned `actions` slot (buttons).
 */
const DashboardHeader = ({ title, subtitle, actions }) => (
  <motion.div
    variants={cardVariants}
    className="flex flex-wrap items-end justify-between gap-3 mb-6"
  >
    <div className="min-w-0">
      <h1 className="font-bricolage text-3xl font-extrabold text-ink truncate">{title}</h1>
      {subtitle && <p className="text-muted mt-1">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </motion.div>
);

export default DashboardHeader;
