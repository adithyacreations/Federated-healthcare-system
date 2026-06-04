import { useEffect, useState } from 'react';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';

const severityClass = (severity) => {
  switch (severity) {
    case 'critical': return 'bg-red-100 text-red-700';
    case 'high': return 'bg-orange-100 text-orange-700';
    case 'moderate': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-green-100 text-green-700';
  }
};

const fmtDate = (iso) => {
  if (!iso) return 'N/A';
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return 'N/A'; }
};

const EmergencyHistoryPage = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const res = await API.get('/api/patient/emergency/history/');
        if (cancelled) return;
        if (res.data?.success) setHistory(res.data.data?.emergencies || []);
      } catch (error) {
        console.log(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-black">🚨 Emergency History</h1>
          <p className="text-gray-500 text-sm">Your past emergency requests</p>
        </div>

        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading history...</p>
          </div>
        )}

        {!loading && history.length === 0 && (
          <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
            <p className="text-5xl mb-4">🚑</p>
            <p className="font-semibold text-gray-700">No Emergency History</p>
            <p className="text-gray-400 text-sm mt-2">
              Your past emergency requests will appear here
            </p>
          </div>
        )}

        {!loading && history.length > 0 && (
          <div className="space-y-4">
            {history.map((emergency, i) => (
              <div key={emergency.emergency_id || i} className="bg-white rounded-2xl p-5 border border-gray-100">
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-black">
                      Emergency #{String(emergency.emergency_id).slice(0, 8).toUpperCase()}
                    </p>
                    <p className="text-sm text-gray-500">{fmtDate(emergency.created_at)}</p>
                  </div>
                  <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase ${severityClass(emergency.severity)}`}>
                    {emergency.severity}
                  </span>
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-3 bg-gray-50 rounded-xl p-3">
                  <div>
                    <p className="text-xs text-gray-400">Hospital</p>
                    <p className="font-medium text-sm text-black">{emergency.hospital_name || 'Assigned'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Driver</p>
                    <p className="font-medium text-sm text-black">{emergency.driver_name || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Status</p>
                    <p className="font-medium text-sm text-black capitalize">{emergency.status || 'Completed'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Last Updated</p>
                    <p className="font-medium text-sm" style={{ color: '#F97316' }}>{fmtDate(emergency.updated_at)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default EmergencyHistoryPage;
