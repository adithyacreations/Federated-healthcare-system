// Color pairs for hospital avatar gradients — deterministic from the name so
// the same hospital always gets the same gradient.
const PALETTE = [
  ['#F97316', '#C9341A'],
  ['#FB923C', '#EA580C'],
  ['#2F6AC9', '#1E40AF'],
  ['#2E8F5B', '#15803D'],
  ['#6B3FD4', '#4F2EA8'],
  ['#D08A1F', '#A16207'],
  ['#C73E2E', '#7A2317'],
  ['#0E0E10', '#3A3530'],
];

export const colorFor = (name = '') => {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
};

export const initials = (name = '?') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export const STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
