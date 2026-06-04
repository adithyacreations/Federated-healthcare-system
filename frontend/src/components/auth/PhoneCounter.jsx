import { useEffect, useState } from 'react';
import API from '../../api/axios';

// Debounced "X/5 accounts registered with this number" helper.
// Calls /api/auth/check-phone/ once the number looks like a valid 10-digit
// Indian mobile, and surfaces the running count under the phone field.
const PhoneCounter = ({ phone }) => {
  const [count, setCount] = useState(0);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const cleaned = (phone || '').replace(/\s/g, '');
    if (!/^[6-9]\d{9}$/.test(cleaned)) {
      setChecked(false);
      setCount(0);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const { data } = await API.post('/api/auth/check-phone/', { phone_number: cleaned });
        if (!active) return;
        if (data?.valid_format) {
          setCount(data.count || 0);
          setChecked(true);
        }
      } catch {
        // network/format error → stay silent, server-side check still guards submit
      }
    }, 400);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [phone]);

  if (!checked || count <= 0) return null;

  const atLimit = count >= 5;
  return (
    <p
      className="text-xs mt-1 font-medium"
      style={{ color: atLimit ? '#EF4444' : '#F97316' }}
    >
      {count}/5 accounts registered with this number
      {atLimit && ' — Maximum reached!'}
    </p>
  );
};

export default PhoneCounter;
