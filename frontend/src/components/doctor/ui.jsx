import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ResponsiveContainer, LineChart, Line } from 'recharts';

// ─── Theme tokens (doctor module) ───────────────────────────────────────────
export const T = {
  bg: '#FAF7F2',
  orange: '#F97316',
  orangeDark: '#EA580C',
  dark: '#000000',
  card: '#FFFFFF',
  border: '#E5E5E5',
  text: '#000000',
  sub: '#666666',
  tint: '#FFF7ED',
};

export const cardHoverDoctor = {
  y: -3,
  boxShadow: '0 12px 30px rgba(249,115,22,0.12)',
  transition: { duration: 0.2 },
};

// ─── Initials avatar ────────────────────────────────────────────────────────
export const DoctorAvatar = ({ name, size = 40, className = '' }) => {
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className={`rounded-full flex items-center justify-center font-semibold text-white shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: T.orange, fontSize: size * 0.38 }}
    >
      {initials}
    </div>
  );
};

// ─── Count-up animation hook ────────────────────────────────────────────────
export const useCountUp = (target = 0, duration = 1500) => {
  const [value, setValue] = useState(0);
  const raf = useRef();
  useEffect(() => {
    const end = Number(target) || 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(Math.round(end * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
};

// Build a small deterministic sparkline series from a single total (UI only).
export const sparkFrom = (total = 0, points = 7) => {
  const base = Math.max(Number(total) || 0, 1);
  return Array.from({ length: points }, (_, i) => {
    const wave = Math.sin((i / points) * Math.PI * 1.5) * 0.25 + 0.75;
    return { i, v: Math.round((base / points) * (i + 1) * wave) + 1 };
  });
};

// ─── Stat card with mini sparkline + count-up ───────────────────────────────
export const SparkStatCard = ({
  icon: Icon,
  title,
  value,
  trend,
  color = T.orange,
  highlight = false,
  index = 0,
}) => {
  const count = useCountUp(value, 1400);
  const data = sparkFrom(value);
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 18 },
        visible: { opacity: 1, y: 0, transition: { delay: index * 0.06 } },
      }}
      whileHover={cardHoverDoctor}
      className="rounded-2xl p-4 border relative overflow-hidden"
      style={{
        backgroundColor: highlight ? T.orange : T.card,
        borderColor: highlight ? T.orange : T.border,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <div className="flex items-start justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: highlight ? 'rgba(255,255,255,0.2)' : T.tint }}
        >
          {Icon && <Icon className="w-4.5 h-4.5" style={{ color: highlight ? '#fff' : color }} />}
        </div>
        {trend && (
          <span
            className="text-[11px] font-semibold"
            style={{ color: highlight ? '#fff' : '#16a34a' }}
          >
            {trend}
          </span>
        )}
      </div>
      <div className="mt-3 text-3xl font-extrabold" style={{ color: highlight ? '#fff' : T.dark }}>
        {count}
      </div>
      <div
        className="text-xs mt-0.5"
        style={{ color: highlight ? 'rgba(255,255,255,0.85)' : T.sub }}
      >
        {title}
      </div>
      <div className="h-8 mt-2 -mx-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="v"
              stroke={highlight ? '#fff' : color}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
};

// ─── Section heading with optional "View All" link ──────────────────────────
export const SectionHead = ({ title, action }) => (
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-lg font-bold" style={{ color: T.dark }}>{title}</h2>
    {action}
  </div>
);
