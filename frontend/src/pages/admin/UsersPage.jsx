import { useState } from 'react';
import { format } from 'date-fns';
import { FiX, FiEye, FiUser, FiActivity } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import useApi from '../../hooks/useApi';

const TABS = [
  { key: 'hospital_admins', label: 'Hospitals' },
  { key: 'doctors', label: 'Doctors' },
  { key: 'patients', label: 'Patients' },
  { key: 'pharmacists', label: 'Pharmacists' },
  { key: 'lab_techs', label: 'Lab Techs' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'vendors', label: 'Vendors' },
];

const RISK_COLORS = {
  high: 'bg-red-100 text-red-700',
  moderate: 'bg-yellow-100 text-yellow-700',
  low: 'bg-green-100 text-green-700',
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy'); } catch { return iso; }
};

const calcAge = (dob) => {
  if (!dob) return '—';
  const birth = new Date(dob);
  const now = new Date();
  return now.getFullYear() - birth.getFullYear();
};

const RiskBadge = ({ level }) => {
  if (!level) return <span className="text-xs text-gray-400 font-medium bg-gray-100 px-2 py-0.5 rounded-full">N/A</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${RISK_COLORS[level] || 'bg-gray-100 text-gray-600'}`}>
      {level}
    </span>
  );
};

const RiskBar = ({ label, value, color }) => (
  <div className="mb-2">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold">{value != null ? `${value}%` : 'N/A'}</span>
    </div>
    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(value || 0, 100)}%` }}
      />
    </div>
  </div>
);

const PatientModal = ({ patient, onClose }) => (
  <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
        <h3 className="font-bold text-primary-500 text-lg">Patient Details</h3>
        <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
          <FiX className="w-5 h-5" />
        </button>
      </div>
      <div className="p-6 space-y-6">
        {/* Personal Info */}
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-orange-500 text-white flex items-center justify-center text-xl font-bold shrink-0">
            {(patient.full_name || 'P').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="font-bold text-lg text-gray-800">{patient.full_name}</div>
            <div className="text-sm text-gray-500">{patient.email}</div>
            <div className="flex gap-2 mt-1 flex-wrap">
              <span className="text-xs bg-primary-50 text-primary-600 px-2 py-0.5 rounded-full font-medium">
                {patient.gender || 'N/A'}
              </span>
              <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">
                Blood: {patient.blood_group || 'N/A'}
              </span>
              <RiskBadge level={patient.risk_level} />
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Age', value: `${calcAge(patient.dob)} yrs` },
            { label: 'BMI', value: patient.bmi ? patient.bmi.toFixed(1) : '—' },
            { label: 'EHR Records', value: patient.ehr_count ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="bg-gray-50 rounded-xl p-3 text-center">
              <div className="text-lg font-bold text-primary-500">{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* EHR by type */}
        {patient.ehr_by_type && Object.keys(patient.ehr_by_type).length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-700 mb-2 text-sm">EHR Records by Type</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(patient.ehr_by_type).map(([type, count]) => (
                <span key={type} className="bg-blue-50 text-blue-700 text-xs px-3 py-1 rounded-full font-medium capitalize">
                  {type}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Risk Assessment */}
        <div>
          <h4 className="font-semibold text-gray-700 mb-3 text-sm">Latest Risk Assessment</h4>
          {patient.diabetes_risk == null && patient.heart_risk == null ? (
            <p className="text-sm text-gray-400 italic">No risk assessment on record.</p>
          ) : (
            <div className="bg-gray-50 rounded-xl p-4">
              <RiskBar label="Diabetes Risk" value={patient.diabetes_risk} color="bg-orange-400" />
              <RiskBar label="Heart Disease Risk" value={patient.heart_risk} color="bg-red-400" />
              <RiskBar label="Hypertension Risk" value={patient.hypertension_risk} color="bg-purple-400" />
            </div>
          )}
        </div>

        {/* Recent EHR */}
        {patient.recent_ehr?.length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-700 mb-2 text-sm">Recent EHR Records</h4>
            <div className="space-y-2">
              {patient.recent_ehr.map((r) => (
                <div key={r.record_id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-xs font-semibold uppercase text-primary-500 mr-2">{r.record_type}</span>
                    <span className="text-sm text-gray-700">{r.title || '—'}</span>
                  </div>
                  <span className="text-xs text-gray-400">{fmtDate(r.recorded_at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-400 border-t pt-3">
          Registered: {fmtDate(patient.created_at)}
        </div>
      </div>
    </div>
  </div>
);

const GenericModal = ({ item, tabKey, onClose }) => {
  const fields = Object.entries(item).filter(
    ([k]) => !['login_id', 'role', 'is_active', 'is_approved', 'recent_ehr', 'ehr_by_type'].includes(k)
  );
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-bold text-primary-500 capitalize">
            {tabKey.replace('_', ' ')} Details
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <FiX className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-lg">
              {((item.full_name || item.hospital_name || item.company_name || item.email || 'U').slice(0, 1)).toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-gray-800">
                {item.full_name || item.hospital_name || item.contact_name || item.company_name || item.email}
              </div>
              <div className="text-sm text-gray-500">{item.email}</div>
            </div>
          </div>
          <div className="space-y-2">
            {fields.map(([key, value]) => (
              <div key={key} className="flex gap-3 py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-xs text-gray-500 w-36 shrink-0 capitalize">{key.replace(/_/g, ' ')}</span>
                <span className="text-sm text-gray-800 font-medium break-all">
                  {value == null ? '—' : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const UsersPage = () => {
  const [tab, setTab] = useState('hospital_admins');
  const [modal, setModal] = useState(null);
  const { data, loading } = useApi('/api/auth/users/');

  const rows = data?.[tab] || [];

  const renderPatientsTable = () => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <th className="px-4 py-3 rounded-tl-lg">Name</th>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Blood Group</th>
            <th className="px-4 py-3">Age</th>
            <th className="px-4 py-3">BMI</th>
            <th className="px-4 py-3">Risk Level</th>
            <th className="px-4 py-3 rounded-tr-lg">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((p, i) => (
            <tr key={p.login_id || i} className="hover:bg-primary-50/30 transition">
              <td className="px-4 py-3 font-medium text-gray-800">{p.full_name || '—'}</td>
              <td className="px-4 py-3 text-gray-500">{p.email}</td>
              <td className="px-4 py-3">
                <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">
                  {p.blood_group || 'N/A'}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-700">{calcAge(p.dob)}</td>
              <td className="px-4 py-3 text-gray-700">{p.bmi ? p.bmi.toFixed(1) : '—'}</td>
              <td className="px-4 py-3"><RiskBadge level={p.risk_level} /></td>
              <td className="px-4 py-3">
                <button
                  onClick={() => setModal({ type: 'patient', data: p })}
                  className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition"
                >
                  <FiEye className="w-3 h-3" /> View Details
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderGenericTable = () => {
    if (rows.length === 0) return null;
    const sample = rows[0];
    const visibleKeys = Object.keys(sample).filter(
      (k) => !['login_id', 'role', 'recent_ehr', 'ehr_by_type'].includes(k)
    ).slice(0, 6);

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              {visibleKeys.map((k) => (
                <th key={k} className="px-4 py-3 capitalize">{k.replace(/_/g, ' ')}</th>
              ))}
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr
                key={row.login_id || i}
                className="hover:bg-primary-50/30 transition cursor-pointer"
                onClick={() => setModal({ type: 'generic', data: row })}
              >
                {visibleKeys.map((k) => (
                  <td key={k} className="px-4 py-3 text-gray-700">
                    {k === 'is_active' || k === 'is_approved' ? (
                      <Badge status={row[k] ? 'success' : 'danger'} text={row[k] ? 'Yes' : 'No'} />
                    ) : k === 'approval_status' ? (
                      <Badge
                        status={row[k] === 'approved' ? 'success' : row[k] === 'pending' ? 'warning' : 'danger'}
                        text={row[k]}
                      />
                    ) : (
                      <span className="truncate block max-w-[180px]">{row[k] == null ? '—' : String(row[k])}</span>
                    )}
                  </td>
                ))}
                <td className="px-4 py-3">
                  <button className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition">
                    <FiEye className="w-3 h-3" /> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
          Users <span style={{ color: '#F97316' }}>·</span> Directory
        </h1>
        <p className="text-sm" style={{ color: '#666' }}>Browse and inspect every registered user by role</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 overflow-x-auto">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              tab === key
                ? 'bg-white text-primary-500 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            {data?.[key] && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                tab === key ? 'bg-primary-100 text-primary-600' : 'bg-gray-200 text-gray-500'
              }`}>
                {data[key].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading users…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            <FiUser className="w-8 h-8 mx-auto mb-2 opacity-30" />
            No {tab.replace('_', ' ')} found.
          </div>
        ) : tab === 'patients' ? (
          renderPatientsTable()
        ) : (
          renderGenericTable()
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'patient' && (
        <PatientModal patient={modal.data} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'generic' && (
        <GenericModal item={modal.data} tabKey={tab} onClose={() => setModal(null)} />
      )}
    </DashboardLayout>
  );
};

export default UsersPage;
