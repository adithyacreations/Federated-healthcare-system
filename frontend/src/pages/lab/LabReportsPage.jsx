import { useState, useMemo } from 'react';
import { FiAlertTriangle, FiFileText, FiSearch } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import StatCard from '../../components/common/StatCard';
import useApi from '../../hooks/useApi';

const LabReportsPage = () => {
  const { data, loading, error } = useApi('/api/lab/reports/');
  const [query, setQuery] = useState('');

  const allReports = useMemo(() => data?.reports || [], [data]);

  const stats = useMemo(() => {
    let abnormal = 0;
    let normal = 0;
    allReports.forEach((r) => {
      if (r.abnormal_count > 0) abnormal += 1; else normal += 1;
    });
    return { total: allReports.length, abnormal, normal };
  }, [allReports]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allReports;
    return allReports.filter((r) => r.patient_name?.toLowerCase().includes(q));
  }, [allReports, query]);

  return (
    <DashboardLayout>
      <h1 className="text-2xl font-bold text-black mb-6">Lab Reports</h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard title="Total Reports" value={stats.total} icon={FiFileText} color="info" />
        <StatCard title="Abnormal Reports" value={stats.abnormal} icon={FiAlertTriangle} color="danger" />
        <StatCard title="Normal Reports" value={stats.normal} icon={FiFileText} color="success" />
      </div>

      {/* Search */}
      <div className="relative max-w-md mb-5">
        <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
        <input
          type="text"
          placeholder="Search by patient name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-full pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-gray-500">Loading reports…</div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-sm text-red-500">Could not load reports.</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-500">
          <FiFileText className="w-8 h-8 mx-auto text-gray-300 mb-2" />
          No reports found.
        </div>
      ) : (
        <div>
          {filtered.map((report) => (
            <div key={report.report_id} className="bg-white rounded-2xl border border-gray-100 p-4 mb-3 hover:shadow-md transition-all">
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: '#F97316' }}>
                    {report.patient_name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-black">{report.patient_name}</p>
                    <p className="text-xs text-gray-500">{report.uploaded_at?.slice(0, 10)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-1 rounded-full"
                    style={{
                      backgroundColor: report.order_type === 'patient_booking' ? '#FFF7ED' : '#F3F4F6',
                      color: report.order_type === 'patient_booking' ? '#F97316' : '#666',
                    }}
                  >
                    {report.order_type === 'patient_booking' ? '👤 Self-Booked' : '👨‍⚕️ Doctor Referred'}
                  </span>
                  {report.abnormal_count > 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-600 font-medium">
                      ⚠️ {report.abnormal_count} Abnormal
                    </span>
                  )}
                </div>
              </div>

              {/* Tests */}
              <div className="flex flex-wrap gap-1 mb-3">
                {Array.isArray(report.tests)
                  ? report.tests.slice(0, 5).map((test, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full" style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}>
                      {typeof test === 'object' ? test.name || test.test_name : test}
                    </span>
                  ))
                  : null}
              </div>

              {/* Results summary */}
              {Array.isArray(report.results) && report.results.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 mb-3">
                  <div className="grid grid-cols-3 gap-2">
                    {report.results.slice(0, 3).map((result, i) => (
                      <div key={i} className="text-center">
                        <p className="text-xs text-gray-500">{result.test_name}</p>
                        <p className={`font-bold text-sm ${report.abnormal_flags?.some((f) => f.test === result.test_name) ? 'text-red-500' : 'text-black'}`}>
                          {result.value} {result.unit}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Footer actions */}
              <div className="flex gap-2">
                {report.report_file_url && (
                  <a
                    href={report.report_file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 py-2 rounded-full text-sm font-medium text-white text-center"
                    style={{ backgroundColor: '#F97316' }}
                  >
                    📥 View Report
                  </a>
                )}
                <div
                  className="flex-1 py-2 rounded-full text-sm font-semibold text-center"
                  style={{ backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}
                >
                  ✅ Auto-saved to patient EHR
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
};

export default LabReportsPage;
