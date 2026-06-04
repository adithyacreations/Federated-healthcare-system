import { motion } from 'framer-motion';
import useCountUp from '../../hooks/useCountUp';

/**
 * HealthScoreRing — animated circular progress ring with a count-up number
 * in the centre. Orange track on a soft track background.
 */
const HealthScoreRing = ({ score = 0, size = 132, stroke = 12, label = 'Health Score' }) => {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Math.round(score)));
  const shown = useCountUp(pct);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#FFE7D6" strokeWidth={stroke} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#F97316"
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (c * pct) / 100 }}
          transition={{ duration: 1.4, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-bricolage text-3xl font-extrabold text-ink leading-none">{shown}</span>
        <span className="text-[11px] text-muted mt-1">{label}</span>
      </div>
    </div>
  );
};

export default HealthScoreRing;
