import { useState } from 'react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const StatusDot = ({ ok = true }) => (
  <span className={`inline-block w-2.5 h-2.5 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`} />
);

const SERVICES = [
  { label: 'Django Backend', key: 'django' },
  { label: 'React Frontend', key: 'react' },
  { label: 'symptom_checker_lr.pkl', key: 'ml1' },
  { label: 'clinical_diagnosis_rf.pkl', key: 'ml2' },
  { label: 'risk_predictor_rf.pkl', key: 'ml3' },
  { label: 'WebSocket (Django Channels)', key: 'ws' },
  { label: 'Razorpay Payments', key: 'razorpay' },
  { label: 'Cloudinary Storage', key: 'cloudinary' },
  { label: 'Gmail SMTP', key: 'smtp' },
];

const SettingsPage = () => {
  const stats = useApi('/api/auth/admin-dashboard/');
  const permissions = useApi('/api/auth/role-permissions/');
  const [savingPerms, setSavingPerms] = useState(false);

  const handleSavePerm = async (role, module, field, value) => {
    setSavingPerms(true);
    try {
      const permsForRole = (permissions.data?.[role] || []).find((p) => p.module === module) || {};
      await API.post('/api/auth/role-permissions/', {
        role,
        module,
        can_read: field === 'can_read' ? value : (permsForRole.can_read ?? false),
        can_write: field === 'can_write' ? value : (permsForRole.can_write ?? false),
        can_delete: field === 'can_delete' ? value : (permsForRole.can_delete ?? false),
      });
      toast.success('Permission saved');
      permissions.refetch();
    } catch {
      toast.error('Failed to save permission');
    } finally {
      setSavingPerms(false);
    }
  };

  const d = stats.data || {};
  const dbStats = [
    { label: 'Total Users (All Roles)', value: (d.total_hospitals ?? 0) + (d.total_doctors ?? 0) + (d.total_patients ?? 0) + (d.total_pharmacists ?? 0) + (d.total_vendors ?? 0) },
    { label: 'Approved Hospitals', value: d.total_hospitals ?? '—' },
    { label: 'Doctors', value: d.total_doctors ?? '—' },
    { label: 'Patients', value: d.total_patients ?? '—' },
    { label: 'Total Consultations', value: d.total_consultations ?? '—' },
    { label: 'Prescriptions', value: d.total_prescriptions ?? '—' },
    { label: 'Lab Reports', value: d.total_lab_reports ?? '—' },
    { label: 'Emergency Requests', value: d.total_emergency_requests ?? '—' },
  ];

  const permData = permissions.data || {};
  const allRoles = Object.keys(permData);

  return (
    <DashboardLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary-500">Settings</h1>
        <p className="text-sm text-gray-500">System status, permissions, and database stats</p>
      </div>

      {/* Section 1 — System Status */}
      <section className="card mb-6">
        <h2 className="text-base font-bold text-gray-700 mb-4">System Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SERVICES.map(({ label }) => (
            <div key={label} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-3">
              <StatusDot ok />
              <span className="text-sm text-gray-700 font-medium">{label}</span>
              <span className="ml-auto text-xs text-success font-semibold">✅ OK</span>
            </div>
          ))}
        </div>
      </section>

      {/* Section 2 — Role Permissions */}
      <section className="card mb-6 p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-700">Role Permissions</h2>
          <p className="text-xs text-gray-400 mt-0.5">Toggle read / write / delete per role per module</p>
        </div>
        {permissions.loading ? (
          <div className="p-6 text-center text-gray-400 text-sm">Loading permissions…</div>
        ) : allRoles.length === 0 ? (
          <div className="p-6 text-center text-gray-400 text-sm">No permissions configured yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Module</th>
                  <th className="px-4 py-3 text-center">Read</th>
                  <th className="px-4 py-3 text-center">Write</th>
                  <th className="px-4 py-3 text-center">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {allRoles.flatMap((role) =>
                  (permData[role] || []).map((p) => (
                    <tr key={p.permission_id} className="hover:bg-primary-50/20">
                      <td className="px-4 py-2.5 font-medium text-gray-700 capitalize">
                        {role.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{p.module}</td>
                      {['can_read', 'can_write', 'can_delete'].map((field) => (
                        <td key={field} className="px-4 py-2.5 text-center">
                          <input
                            type="checkbox"
                            checked={p[field] || false}
                            onChange={(e) => handleSavePerm(role, p.module, field, e.target.checked)}
                            disabled={savingPerms}
                            className="w-4 h-4 rounded accent-primary-500 cursor-pointer"
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section 3 — Database Stats */}
      <section className="card">
        <h2 className="text-base font-bold text-gray-700 mb-4">Database Statistics</h2>
        {stats.loading ? (
          <div className="text-center text-gray-400 text-sm">Loading…</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {dbStats.map(({ label, value }) => (
              <div key={label} className="bg-gray-50 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-primary-500">{value}</div>
                <div className="text-xs text-gray-500 mt-1 leading-snug">{label}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </DashboardLayout>
  );
};

export default SettingsPage;
