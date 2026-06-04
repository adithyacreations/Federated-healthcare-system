import { motion } from 'framer-motion';

/**
 * AnimatedTabs — pill-row of tabs with a sliding orange underline
 * (Framer Motion shared layout). `tabs` is an array of strings or
 * { key, label } objects.
 */
const AnimatedTabs = ({ tabs, active, onChange, layoutId = 'tab-underline' }) => (
  <div className="flex flex-wrap gap-1 border-b border-hairline mb-5">
    {tabs.map((t) => {
      const key = t.key ?? t;
      const label = t.label ?? t;
      const on = active === key;
      return (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`relative px-4 py-2.5 text-sm font-semibold capitalize transition ${
            on ? 'text-orange-500' : 'text-muted hover:text-ink'
          }`}
        >
          {label}
          {on && (
            <motion.span
              layoutId={layoutId}
              className="absolute left-2 right-2 -bottom-px h-0.5 bg-orange-500 rounded-full"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
        </button>
      );
    })}
  </div>
);

export default AnimatedTabs;
