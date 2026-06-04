import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { FiSearch, FiFileText, FiDownload, FiChevronDown, FiChevronUp } from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { T } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import { openPrescriptionPdf } from '../../utils/pdf';

const PrescriptionsPage = () => {
  const { data, loading, error } = useApi('/api/doctor/prescriptions/');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState({});

  const prescriptions = useMemo(() => data?.data || [], [data]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prescriptions;
    return prescriptions.filter((rx) => rx.patient_name?.toLowerCase().includes(q));
  }, [prescriptions, query]);

  const medLabel = (m) =>
    [m.name, m.dosage, m.frequency, m.duration || (m.days ? `${m.days} days` : '')].filter(Boolean).join(' · ');

  const DateBadge = ({ iso }) => {
    let day = '--'; let mon = '';
    try { const dt = new Date(iso); day = format(dt, 'dd'); mon = format(dt, 'MMM'); } catch { /* noop */ }
    return (
      <div className="w-14 h-14 rounded-xl flex flex-col items-center justify-center shrink-0" style={{ backgroundColor: T.tint }}>
        <span className="text-lg font-extrabold leading-none" style={{ color: T.orange }}>{day}</span>
        <span className="text-[11px] uppercase font-semibold" style={{ color: T.orange }}>{mon}</span>
      </div>
    );
  };

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>Prescriptions</h1>
            <p className="text-sm" style={{ color: T.sub }}>All prescriptions you have issued</p>
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

        {loading ? (
          <div className="rounded-2xl p-6 bg-white border text-sm" style={{ borderColor: T.border, color: T.sub }}>Loading prescriptions…</div>
        ) : error ? (
          <div className="rounded-2xl p-6 bg-white border text-sm text-red-500" style={{ borderColor: T.border }}>Could not load prescriptions.</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl p-10 bg-white border text-center" style={{ borderColor: T.border, color: T.sub }}>
            <FiFileText className="w-9 h-9 mx-auto text-gray-300 mb-2" />
            <div className="text-sm">No prescriptions found.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((rx) => {
              const meds = Array.isArray(rx.medicines) ? rx.medicines : [];
              const open = expanded[rx.prescription_id];
              const shown = open ? meds : meds.slice(0, 2);
              return (
                <motion.div key={rx.prescription_id} variants={cardVariants} className="rounded-2xl p-4 bg-white border" style={{ borderColor: T.border }}>
                  <div className="flex items-start gap-4">
                    <DateBadge iso={rx.created_at} />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold" style={{ color: T.dark }}>{rx.patient_name}</div>
                          <div className="text-xs" style={{ color: T.sub }}>
                            {rx.diagnosis || 'No diagnosis'}{rx.valid_until && ` · valid until ${rx.valid_until}`}
                          </div>
                          <span className="inline-block mt-1.5 text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>
                            {meds.length} medicine(s)
                          </span>
                        </div>
                        <button
                          onClick={() => openPrescriptionPdf(rx.prescription_id)}
                          className="inline-flex items-center gap-1 text-white px-3 py-2 rounded-full text-xs font-semibold shrink-0"
                          style={{ backgroundColor: T.orange }}
                        >
                          <FiDownload className="w-3.5 h-3.5" /> Download PDF
                        </button>
                      </div>

                      <ul className="mt-2 text-sm space-y-0.5" style={{ color: T.dark }}>
                        {shown.map((m, i) => (<li key={i}>• {medLabel(m)}</li>))}
                      </ul>
                      {rx.instructions && open && (
                        <p className="text-xs mt-2" style={{ color: T.sub }}>Instructions: {rx.instructions}</p>
                      )}
                      {meds.length > 2 && (
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [rx.prescription_id]: !open }))}
                          className="text-xs inline-flex items-center gap-1 mt-2 hover:underline font-medium"
                          style={{ color: T.orange }}
                        >
                          {open ? <FiChevronUp /> : <FiChevronDown />}
                          {open ? 'Show less' : `View full (${meds.length} medicines)`}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </motion.div>
    </DoctorLayout>
  );
};

export default PrescriptionsPage;
