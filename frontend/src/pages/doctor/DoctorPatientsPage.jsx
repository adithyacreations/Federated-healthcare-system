import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { FiUser, FiSearch, FiUsers, FiCalendar } from 'react-icons/fi';

import DoctorLayout from '../../components/doctor/DoctorLayout';
import { T, DoctorAvatar, cardHoverDoctor } from '../../components/doctor/ui';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';

const DoctorPatientsPage = () => {
  const { data, loading, error } = useApi('/api/doctor/patients/');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const patients = data?.patients || [];
    const q = query.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => p.full_name?.toLowerCase().includes(q));
  }, [data, query]);

  const safeFmt = (iso) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'dd MMM yyyy'); } catch { return iso; }
  };

  return (
    <DoctorLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div>
            <h1 className="text-2xl font-extrabold" style={{ color: T.dark }}>My Patients</h1>
            <p className="text-sm" style={{ color: T.sub }}>Patients who have consulted with you</p>
          </div>
          <div className="relative">
            <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search patients…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 pr-4 py-2.5 w-64 rounded-full bg-white border text-sm focus:outline-none focus:border-orange-400"
              style={{ borderColor: T.border }}
            />
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl p-6 bg-white border text-sm" style={{ borderColor: T.border, color: T.sub }}>Loading patients…</div>
        ) : error ? (
          <div className="rounded-2xl p-6 bg-white border text-sm text-red-500" style={{ borderColor: T.border }}>Could not load patients.</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl p-10 bg-white border text-center" style={{ borderColor: T.border, color: T.sub }}>
            <FiUsers className="w-9 h-9 mx-auto text-gray-300 mb-2" />
            <div className="text-sm">
              {query ? 'No patients match your search.' : 'No patients yet — they appear here after their first consultation.'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((p) => (
              <motion.div
                key={p.patient_id}
                variants={cardVariants}
                whileHover={cardHoverDoctor}
                className="rounded-2xl bg-white border overflow-hidden"
                style={{ borderColor: T.border }}
              >
                <div className="h-16 relative" style={{ background: `linear-gradient(135deg, ${T.orange}, ${T.orangeDark})` }}>
                  <div className="absolute -bottom-6 left-5">
                    <div className="ring-4 ring-white rounded-full">
                      <DoctorAvatar name={p.full_name} size={52} />
                    </div>
                  </div>
                </div>
                <div className="p-5 pt-8">
                  <div className="font-bold truncate" style={{ color: T.dark }}>{p.full_name}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: T.tint, color: T.orange }}>
                      {p.age != null ? `${p.age} yrs` : 'Age —'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#f3f4f6', color: T.sub }}>
                      {p.gender || '—'}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: '#fee2e2', color: '#dc2626' }}>
                      🩸 {p.blood_group || '—'}
                    </span>
                  </div>
                  <div className="text-xs mt-3" style={{ color: T.sub }}>
                    {p.total_consultations} consultation(s) · last {safeFmt(p.last_consultation_date)}
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Link
                      to={`/doctor/patient-ehr/${p.patient_id}`}
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: T.dark }}
                    >
                      <FiUser className="w-3.5 h-3.5" /> View EHR
                    </Link>
                    <Link
                      to="/doctor/consultations"
                      className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-full text-xs font-semibold text-white"
                      style={{ backgroundColor: T.orange }}
                    >
                      <FiCalendar className="w-3.5 h-3.5" /> New Visit
                    </Link>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </DoctorLayout>
  );
};

export default DoctorPatientsPage;
