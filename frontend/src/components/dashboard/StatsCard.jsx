import { motion } from 'framer-motion';
import { FiArrowUp, FiArrowDown } from 'react-icons/fi';
import { cardVariants, cardHover } from './variants';
import useCountUp from '../../hooks/useCountUp';

/**
 * StatsCard — white rounded card with an orange icon, a big count-up number
 * and a small grey label. Optional `trend` (number) shows an up/down chip.
 *
 *   <StatsCard icon={FiUsers} title="Total Doctors" value={12} trend={8} />
 *   <StatsCard icon={FiDollarSign} title="Revenue" value={45000} prefix="₹" />
 */
const StatsCard = ({ icon: Icon, title, value, trend, prefix = '', suffix = '' }) => {
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const counted = useCountUp(numeric ? value : 0);
  const shown = numeric
    ? `${prefix}${Number(counted).toLocaleString()}${suffix}`
    : (value ?? '—');

  const trendUp = typeof trend === 'number' ? trend >= 0 : null;

  return (
    <motion.div
      variants={cardVariants}
      whileHover={cardHover}
      className="bg-white rounded-2xl border border-hairline p-5 flex items-start gap-4"
    >
      {Icon && (
        <div className="p-3 rounded-xl bg-orange-50 text-orange-500 shrink-0">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-bricolage text-3xl font-extrabold text-ink truncate leading-tight">
          {shown}
        </p>
        <p className="text-sm text-muted mt-0.5 truncate">{title}</p>
        {trendUp !== null && (
          <div
            className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${
              trendUp ? 'text-green-600' : 'text-red-500'
            }`}
          >
            {trendUp ? <FiArrowUp /> : <FiArrowDown />}
            <span>{Math.abs(trend)}%</span>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default StatsCard;
