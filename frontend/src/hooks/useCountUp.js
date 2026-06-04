import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from 0 → target on mount (easeOut), over `duration` ms.
 * Non-numeric values (e.g. '—', '₹0', 'None') are returned unchanged.
 *
 *   const shown = useCountUp(42);        // counts 0 → 42
 *   const shown = useCountUp('None');    // stays 'None'
 */
export default function useCountUp(target, duration = 1500) {
  const num = Number(target);
  const numeric = target !== null && target !== '' && Number.isFinite(num);
  const [value, setValue] = useState(numeric ? 0 : target);
  const rafRef = useRef();

  useEffect(() => {
    if (!numeric) {
      setValue(target);
      return undefined;
    }
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(Math.round(num * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, num, numeric]);

  return value;
}
