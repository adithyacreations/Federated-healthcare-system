// Indian 12-hour time formatting helpers for lab slots and appointments.

export const formatTime12hr = (timeStr) => {
  if (!timeStr) return '';
  try {
    const [hours, minutes] = String(timeStr).split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return timeStr;
    const period = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12}:${String(minutes).padStart(2, '0')} ${period}`;
  } catch {
    return timeStr;
  }
};

export const formatDateTime12hr = (dateStr, timeStr) => {
  if (!dateStr) return formatTime12hr(timeStr);
  const date = new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  return timeStr ? `${date} at ${formatTime12hr(timeStr)}` : date;
};
