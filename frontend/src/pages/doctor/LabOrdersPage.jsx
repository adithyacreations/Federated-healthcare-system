import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { FiSearch, FiClipboard, FiExternalLink, FiAlertTriangle } from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { T, DoctorAvatar } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';

const STATUS_BADGE = {
  pending: { bg: '#fef9c3', color: '#a16207' },
  confirmed: { bg: '#dbeafe', color: '#1d4ed8' },
  processing: { bg: '#ede9fe', color: '#7c3aed' },
  completed: { bg: '#dcfce7', color: '#15803d' },
  cancelled: { bg: '#fee2e2', color: '#b91c1c' },
};

const FILTERS = ['all', 'pending', 'processing', 'completed'];

const priorityStyle = (p) => {
  const v = (p || '').toLowerCase();
  if (v === 'stat') return { bg: '#fee2e2', color: '#b91c1c' };
  if (v === 'urgent') return { bg: T.tint, color: T.orange };
  return { bg: '#f3f4f6', color: T.sub };
};

const testLabel = (t) => (typeof t === 'object' ? t?.name || t?.test_name : t);

const LabOrdersPage = () => {
  const { data, loading, error } = useApi('/api/doctor/lab-orders/');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedOrder, setExpandedOrder] = useState(null);

  const orders = useMemo(() => data?.data || [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.patient_name?.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      return true;
    });
  }, [orders, query, statusFilter]);

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>Lab Orders</h1>
            <p className="text-sm" style={{ color: T.sub }}>Tests you have ordered and their results</p>
          </div>
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              className="pl-9 pr-4 py-2.5 w-64 rounded-full bg-white border text-sm focus:outline-none focus:border-orange-400"
              style={{ borderColor: T.border }}
              placeholder="Search by patient…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 mb-5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className="px-4 py-1.5 rounded-full text-sm font-medium capitalize border transition"
              style={statusFilter === f
                ? { backgroundColor: T.orange, color: '#fff', borderColor: T.orange }
                : { backgroundColor: '#fff', color: T.sub, borderColor: T.border }}
            >
              {f}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-2xl p-6 bg-white border text-sm" style={{ borderColor: T.border, color: T.sub }}>Loading lab orders…</div>
        ) : error ? (
          <div className="rounded-2xl p-6 bg-white border text-sm text-red-500" style={{ borderColor: T.border }}>Could not load lab orders.</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl p-10 bg-white border text-center" style={{ borderColor: T.border, color: T.sub }}>
            <FiClipboard className="w-9 h-9 mx-auto text-gray-300 mb-2" />
            <div className="text-sm">No lab orders found.</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filtered.map((o) => {
              const flags = Array.isArray(o.abnormal_flags) ? o.abnormal_flags : [];
              const tests = Array.isArray(o.tests) ? o.tests : [o.tests];
              const sb = STATUS_BADGE[o.status] || { bg: '#f3f4f6', color: T.sub };
              const pr = priorityStyle(o.priority);
              const expanded = expandedOrder === o.order_id;
              return (
                <motion.div key={o.order_id} variants={cardVariants} className="rounded-2xl p-4 bg-white border" style={{ borderColor: T.border }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <DoctorAvatar name={o.patient_name} size={40} />
                      <div className="min-w-0">
                        <div className="font-bold truncate" style={{ color: T.dark }}>{o.patient_name}</div>
                        <div className="text-xs" style={{ color: T.sub }}>
                          {o.patient_blood_group || '—'} · Age {o.patient_age ?? '—'}
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1.5">
                      <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full" style={{ backgroundColor: pr.bg, color: pr.color }}>
                        {o.priority}
                      </span>
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: sb.bg, color: sb.color }}>
                        {o.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {tests.map((t, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>
                        {testLabel(t)}
                      </span>
                    ))}
                  </div>

                  {flags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {flags.map((f, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold inline-flex items-center gap-0.5" style={{ backgroundColor: '#fee2e2', color: '#b91c1c' }}>
                          <FiAlertTriangle className="w-2.5 h-2.5" /> {f.test || f}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: '#f3f4f6' }}>
                    <div className="text-xs" style={{ color: T.sub }}>
                      {o.lab_tech_name || 'Lab tech not assigned'}
                      {o.ordered_at && <span> · {o.ordered_at.slice(0, 10)}</span>}
                    </div>
                    {o.report_url ? (
                      <a href={o.report_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-white px-3 py-1.5 rounded-full text-xs font-semibold" style={{ backgroundColor: T.dark }}>
                        <FiExternalLink className="w-3 h-3" /> View Report
                      </a>
                    ) : o.notes ? (
                      <button onClick={() => setExpandedOrder(expanded ? null : o.order_id)} className="text-xs font-medium hover:underline" style={{ color: T.orange }}>
                        {expanded ? 'Hide notes' : 'View notes'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">No report yet</span>
                    )}
                  </div>

                  {expanded && o.notes && (
                    <p className="text-sm mt-2 p-3 rounded-xl" style={{ backgroundColor: T.bg, color: T.dark }}><b>Notes:</b> {o.notes}</p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </DoctorLayout>
  );
};

export default LabOrdersPage;
