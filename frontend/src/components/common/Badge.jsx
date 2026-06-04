const styleMap = {
  approved: 'badge-success',
  active: 'badge-success',
  completed: 'badge-success',
  paid: 'badge-success',
  delivered: 'badge-success',
  success: 'badge-success',

  pending: 'badge-warning',
  processing: 'badge-warning',
  warning: 'badge-warning',

  rejected: 'badge-danger',
  failed: 'badge-danger',
  cancelled: 'badge-danger',
  critical: 'badge-danger',
  emergency: 'badge-danger',
  danger: 'badge-danger',

  info: 'badge-info',
  scheduled: 'badge-info',
  dispatched: 'badge-info',
  confirmed: 'badge-info',
};

const Badge = ({ status = 'info', text }) => {
  const key = String(status).toLowerCase();
  const cls = styleMap[key] || 'badge-info';
  const label = text || (status ? String(status).replace(/_/g, ' ') : '—');
  return <span className={cls}>{label}</span>;
};

export default Badge;
