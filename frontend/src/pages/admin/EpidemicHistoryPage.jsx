import { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import { FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import useApi from '../../hooks/useApi';

const LEVEL_BADGE = {
  low:      'bg-blue-100   text-blue-800',
  moderate: 'bg-yellow-100 text-yellow-800',
  high:     'bg-orange-100 text-orange-800',
  critical: 'bg-red-100    text-red-800',
};

const AlertBadge = ({ level }) => (
  <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${LEVEL_BADGE[level] || LEVEL_BADGE.low}`}>
    {level}
  </span>
);

/**
 * Full epidemic history — every recorded trend plus a cases-per-disease chart.
 * Split out of the main Epidemic Alerts page to keep that page focused on
 * active spikes.
 */
const EpidemicHistoryPage = () => {
  const epidemic = useApi('/api/federated/epidemic/');
  const allTrends = useMemo(() => epidemic.data?.trends || [], [epidemic.data]);

  const stats = useMemo(() => ({
    total: allTrends.length,
    spikes: allTrends.filter((t) => t.spike_detected).length,
    active: allTrends.filter((t) => !t.is_resolved).length,
    resolved: allTrends.filter((t) => t.is_resolved).length,
  }), [allTrends]);

  // Aggregate total cases per disease for the bar chart (top 8 by cases).
  const chartData = useMemo(() => {
    const byDisease = {};
    allTrends.forEach((t) => {
      byDisease[t.disease_name] = (byDisease[t.disease_name] || 0) + (t.case_count || 0);
    });
    return Object.entries(byDisease)
      .map(([disease, cases]) => ({ disease, cases }))
      .sort((a, b) => b.cases - a.cases)
      .slice(0, 8);
  }, [allTrends]);

  const STAT_CARDS = [
    { label: 'Total Trends', value: stats.total, color: '#101010' },
    { label: 'Spikes', value: stats.spikes, color: '#EF4444' },
    { label: 'Active', value: stats.active, color: '#F97316' },
    { label: 'Resolved', value: stats.resolved, color: '#22C55E' },
  ];

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            Epidemic History <span style={{ color: '#F97316' }}>·</span> Trends
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Every recorded epidemic trend and case distribution</p>
        </div>
        <button
          onClick={epidemic.refetch}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {STAT_CARDS.map((s) => (
          <div key={s.label} className="card text-center py-5">
            <div className="text-3xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1 uppercase tracking-wide">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Cases-per-disease chart */}
      <section className="mb-6">
        <h2 className="text-lg font-semibold text-primary-500 mb-4">Cases by Disease</h2>
        <div className="card">
          {chartData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-10">No trend data to chart yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                <XAxis dataKey="disease" tick={{ fontSize: 12, fill: '#666' }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 12, fill: '#666' }} />
                <Tooltip />
                <Bar dataKey="cases" fill="#F97316" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* Full trends table */}
      <section>
        <h2 className="text-lg font-semibold text-primary-500 mb-4">All Trends</h2>
        <div className="card p-0 overflow-hidden">
          {epidemic.loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : allTrends.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No epidemic trends recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                    <th className="px-4 py-3">Disease</th>
                    <th className="px-4 py-3">Region</th>
                    <th className="px-4 py-3">Cases</th>
                    <th className="px-4 py-3">Alert Level</th>
                    <th className="px-4 py-3">Spike</th>
                    <th className="px-4 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {allTrends.map((t) => (
                    <tr key={t.trend_id} className={`hover:bg-orange-50/40 transition ${t.spike_detected ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 font-semibold text-gray-800">{t.disease_name}</td>
                      <td className="px-4 py-3 text-gray-600">{t.region || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-700">{t.case_count?.toLocaleString?.() ?? t.case_count}</td>
                      <td className="px-4 py-3"><AlertBadge level={t.alert_level} /></td>
                      <td className="px-4 py-3">
                        {t.spike_detected
                          ? <span className="text-xs font-bold text-danger">🚨 Yes</span>
                          : <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{t.recorded_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
};

export default EpidemicHistoryPage;
