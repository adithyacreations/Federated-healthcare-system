import { useState, useCallback } from 'react';
import { FiSearch, FiDownload, FiChevronLeft, FiChevronRight, FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import useApi from '../../hooks/useApi';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

const MODULE_COLORS = {
  auth:      'bg-blue-100   text-blue-700',
  federated: 'bg-purple-100 text-purple-700',
  hospital:  'bg-green-100  text-green-700',
  doctor:    'bg-teal-100   text-teal-700',
  patient:   'bg-cyan-100   text-cyan-700',
  pharmacy:  'bg-orange-100 text-orange-700',
  lab:       'bg-pink-100   text-pink-700',
  emergency: 'bg-red-100    text-red-700',
  vendor:    'bg-indigo-100 text-indigo-700',
};

const AuditLogsPage = () => {
  const [search, setSearch]     = useState('');
  const [module, setModule]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [page, setPage]         = useState(1);

  const params = { page, search: search || undefined, module: module || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined };
  const logs = useApi('/api/auth/audit-logs/', { params });

  const handleSearch = (e) => { setSearch(e.target.value); setPage(1); };
  const handleModule = (e) => { setModule(e.target.value); setPage(1); };

  const exportCSV = useCallback(() => {
    const rows = logs.data?.logs || [];
    if (!rows.length) return;
    const header = ['Action', 'Module', 'User Email', 'Entity Type', 'IP Address', 'Time'];
    const lines = rows.map((l) => [
      l.action, l.module, l.login_email || '', l.entity_type || '', l.ip_address || '', fmtDate(l.logged_at),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_page${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs.data, page]);

  const totalPages = logs.data?.pages || 1;
  const total = logs.data?.total || 0;
  const modules = logs.data?.modules || [];
  const logRows = logs.data?.logs || [];

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Audit Logs</h1>
          <p className="text-sm text-gray-500">Complete system activity trail · {total} records</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={logs.refetch}
            className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition"
          >
            <FiRefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button
            onClick={exportCSV}
            disabled={!logRows.length}
            className="inline-flex items-center gap-2 text-sm bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:bg-orange-600 transition disabled:opacity-40"
          >
            <FiDownload className="w-4 h-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search action or module…"
              value={search}
              onChange={handleSearch}
              className="w-full border border-gray-200 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <select
            value={module}
            onChange={handleModule}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
          >
            <option value="">All Modules</option>
            {modules.map((m) => <option key={m} value={m} className="capitalize">{m}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden mb-4">
        {logs.loading ? (
          <div className="p-10 text-center text-gray-400 text-sm">Loading audit logs…</div>
        ) : logRows.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">No audit logs match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3">User Email</th>
                  <th className="px-4 py-3">Entity</th>
                  <th className="px-4 py-3">IP Address</th>
                  <th className="px-4 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {logRows.map((l, i) => (
                  <tr key={l.log_id || i} className="hover:bg-primary-50/20 transition">
                    <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[180px] truncate" title={l.action}>
                      {l.action}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${MODULE_COLORS[l.module] || 'bg-gray-100 text-gray-600'}`}>
                        {l.module || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 text-xs">{l.login_email || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{l.entity_type || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs font-mono">{l.ip_address || '—'}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{fmtDate(l.logged_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>Page {page} of {totalPages} · {total} total records</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-primary-50 transition"
          >
            <FiChevronLeft className="w-4 h-4" />
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const start = Math.max(1, Math.min(page - 2, totalPages - 4));
            const n = start + i;
            if (n > totalPages) return null;
            return (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition ${
                  n === page ? 'bg-orange-500 text-white' : 'border border-gray-200 hover:bg-primary-50'
                }`}
              >
                {n}
              </button>
            );
          })}
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-primary-50 transition"
          >
            <FiChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default AuditLogsPage;
