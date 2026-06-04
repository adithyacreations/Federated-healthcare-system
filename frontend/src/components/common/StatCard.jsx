import { FiArrowUp, FiArrowDown } from 'react-icons/fi';

const colorMap = {
  primary: 'bg-primary-50 text-primary-600',
  success: 'bg-green-50 text-success',
  warning: 'bg-yellow-50 text-warning',
  danger: 'bg-red-50 text-danger',
  info: 'bg-blue-50 text-secondary',
};

const StatCard = ({ title, value, icon: Icon, color = 'primary', trend, trendLabel }) => {
  const trendUp = typeof trend === 'number' ? trend >= 0 : null;

  return (
    <div className="card flex items-start gap-4 hover:shadow-hover transition-all">
      {Icon && (
        <div className={`p-3 rounded-xl ${colorMap[color] || colorMap.primary}`}>
          <Icon className="w-6 h-6" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs uppercase tracking-wide text-gray-500 font-medium">{title}</p>
        <p className="mt-1 text-2xl font-bold text-primary-500 truncate">{value}</p>
        {trend !== undefined && trend !== null && (
          <div
            className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${
              trendUp ? 'text-success' : 'text-danger'
            }`}
          >
            {trendUp ? <FiArrowUp /> : <FiArrowDown />}
            <span>{Math.abs(trend)}%</span>
            {trendLabel && <span className="text-gray-400 font-normal">· {trendLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default StatCard;
