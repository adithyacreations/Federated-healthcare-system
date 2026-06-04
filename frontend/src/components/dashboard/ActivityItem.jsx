/**
 * ActivityItem — clean list row with a colored dot (by `type`), text on the
 * left and a timestamp on the right. Subtle bottom border (removed on last).
 */
const DOT = {
  order: 'bg-orange-500',
  ehr: 'bg-blue-500',
  consultation: 'bg-blue-500',
  lab: 'bg-purple-500',
  alert: 'bg-red-500',
  emergency: 'bg-red-500',
  success: 'bg-green-500',
  default: 'bg-gray-300',
};

const ActivityItem = ({ text, time, type = 'default' }) => (
  <div className="flex items-center justify-between gap-3 py-3 border-b border-hairline last:border-0">
    <div className="flex items-center gap-3 min-w-0">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${DOT[type] || DOT.default}`} />
      <span className="text-sm text-ink truncate">{text}</span>
    </div>
    {time && <span className="text-xs text-muted shrink-0">{time}</span>}
  </div>
);

export default ActivityItem;
