import { FiCheckCircle, FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import useApi from '../../hooks/useApi';

/**
 * Resolved epidemic alerts — moved out of the main Epidemic Alerts page so the
 * monitor stays focused on active spikes. Read-only history of closed alerts
 * with disease, region, case count and resolution details.
 */
const ResolvedAlertsPage = () => {
  const epidemic = useApi('/api/federated/epidemic/');

  const allTrends = epidemic.data?.trends || [];
  const resolved = epidemic.data?.resolved || allTrends.filter((t) => t.is_resolved);

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            Resolved Alerts <span style={{ color: '#F97316' }}>·</span> History
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Epidemic alerts that have been marked resolved</p>
        </div>
        <button
          onClick={epidemic.refetch}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {epidemic.loading ? (
        <div className="card text-center text-gray-400 text-sm py-10">Loading…</div>
      ) : resolved.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-4xl mb-2">🗂️</div>
          <div className="text-gray-500 font-medium">No resolved alerts yet.</div>
          <div className="text-gray-400 text-sm mt-1">Resolved epidemics will be archived here.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {resolved.map((e) => (
            <div key={e.trend_id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 flex items-center gap-2">
                    <FiCheckCircle className="w-4 h-4 text-green-600" /> {e.disease_name}
                  </p>
                  <p className="text-sm text-gray-500">
                    📍 {e.region || '—'} • {e.case_count?.toLocaleString?.() ?? e.case_count} cases
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Resolved: {e.resolved_at ? new Date(e.resolved_at).toLocaleString('en-IN') : '—'}
                  </p>
                  {e.resolution_note && (
                    <p className="text-xs text-gray-500 italic mt-1">"{e.resolution_note}"</p>
                  )}
                </div>
                <span className="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-full font-semibold whitespace-nowrap">
                  Resolved ✅
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
};

export default ResolvedAlertsPage;
