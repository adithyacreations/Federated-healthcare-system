import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';

import DashboardLayout from '../common/DashboardLayout';
import API from '../../api/axios';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const YEARS = [2024, 2025, 2026];

const csvEscape = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;

/**
 * Reusable monthly analytics report (lab + pharmacy share it). The caller
 * supplies the endpoint, summary cards, breakdown table columns, and the CSV
 * row builder; this component owns the month/year picker, fetch, loading, the
 * cards + table layout, and CSV download. Theme: cream #FAF7F2 / orange #F97316.
 */
export default function MonthlyReport({
  title,
  subtitle,
  endpoint,
  summaryCards,
  breakdownTitle,
  breakdownColumns,
  breakdownRows,
  buildCsvRows,
  csvFilename,
}) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await API.get(endpoint, { params: { month, year } });
      if (data?.success) setReport(data.data);
    } catch {
      toast.error('Failed to load report!');
    } finally {
      setLoading(false);
    }
  }, [endpoint, month, year]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const exportCSV = () => {
    if (!report) return;
    const csv = buildCsvRows(report)
      .map((row) => row.map(csvEscape).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvFilename(report);
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported!');
  };

  const cards = report ? summaryCards(report) : [];
  const rows = report ? breakdownRows(report) : [];

  return (
    <DashboardLayout>
      <div className="min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-extrabold text-black m-0">📊 {title}</h1>
            <p className="text-gray-500 text-sm mt-1">{subtitle}</p>
          </div>
          <button
            onClick={exportCSV}
            disabled={!report}
            className="px-5 py-2.5 rounded-xl font-semibold text-white text-sm disabled:cursor-not-allowed"
            style={{ backgroundColor: report ? '#000000' : '#E5E5E5' }}
          >
            ⬇️ Export CSV
          </button>
        </div>

        {/* Month / Year picker */}
        <div className="flex gap-3 mb-6 flex-wrap">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="px-4 py-2.5 rounded-xl text-sm bg-white outline-none cursor-pointer"
            style={{ border: '1.5px solid #E5E5E5' }}
          >
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-4 py-2.5 rounded-xl text-sm bg-white outline-none cursor-pointer"
            style={{ border: '1.5px solid #E5E5E5' }}
          >
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={fetchReport}
            className="px-5 py-2.5 rounded-xl font-semibold text-white text-sm"
            style={{ backgroundColor: '#F97316' }}
          >
            Generate
          </button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Loading report…</div>
        ) : !report ? (
          <div className="text-center py-16 text-gray-400">No data available.</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {cards.map((c) => (
                <div key={c.label} className="bg-white rounded-2xl p-5" style={{ border: '1px solid #E5E5E5' }}>
                  <p className="text-2xl m-0 mb-2">{c.icon}</p>
                  <p className="text-2xl font-extrabold m-0 mb-1" style={{ color: c.color }}>{c.value}</p>
                  <p className="text-[13px] text-gray-400 m-0">{c.label}</p>
                </div>
              ))}
            </div>

            {/* Breakdown table */}
            <div className="bg-white rounded-2xl p-5" style={{ border: '1px solid #E5E5E5' }}>
              <h3 className="font-bold mb-4">{breakdownTitle}</h3>
              {rows.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">No data for this month.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr style={{ backgroundColor: '#FAF7F2' }}>
                        {breakdownColumns.map((col) => (
                          <th
                            key={col.key}
                            className="py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                            style={{ textAlign: col.align || 'left' }}
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #F5F5F5' }}>
                          {breakdownColumns.map((col) => (
                            <td
                              key={col.key}
                              className="py-3 px-4 text-sm"
                              style={{
                                textAlign: col.align || 'left',
                                color: col.color || '#111',
                                fontWeight: col.bold ? 700 : 500,
                              }}
                            >
                              {col.format ? col.format(row[col.key], row) : row[col.key]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
