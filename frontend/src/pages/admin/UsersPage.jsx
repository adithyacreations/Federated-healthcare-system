import { useState } from 'react';
import { FiX, FiEye, FiUser } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import toast from 'react-hot-toast';

// Tabs the super admin can suspend / terminate, mapped to the platform entity type.
const ENTITY_TYPE_BY_TAB = { hospital_admins: 'hospital', vendors: 'vendor' };

const PlatformActionButtons = ({ row, entityType, onAct }) => (
  <div className="inline-flex gap-2">
    {row.is_active === false ? (
      <button
        onClick={(e) => { e.stopPropagation(); onAct('resume', entityType, row); }}
        className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap"
        style={{ backgroundColor: '#F0FDF4', color: '#16A34A', border: '1px solid #86EFAC' }}
      >
        ✅ Resume
      </button>
    ) : (
      <button
        onClick={(e) => { e.stopPropagation(); onAct('suspend', entityType, row); }}
        className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap"
        style={{ backgroundColor: 'white', color: '#F97316', border: '1.5px solid #F97316' }}
      >
        🔴 Suspend
      </button>
    )}
    <button
      onClick={(e) => { e.stopPropagation(); onAct('terminate', entityType, row); }}
      className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1.5px solid #FCA5A5' }}
    >
      ⛔ Terminate
    </button>
  </div>
);

const TABS = [
  { key: 'hospital_admins', label: 'Hospitals' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'vendors', label: 'Vendors' },
];

const GenericModal = ({ item, tabKey, onClose }) => {
  const fields = Object.entries(item).filter(
    ([k]) => !['login_id', 'role', 'is_active', 'is_approved'].includes(k)
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
  const { data, loading, refetch } = useApi('/api/auth/users/');

  // Hide the row immediately while the authoritative directory reloads.
  const [removedIds, setRemovedIds] = useState(() => new Set());

  const rows = (data?.[tab] || []).filter((r) => !removedIds.has(r.login_id));
  const actionEntityType = ENTITY_TYPE_BY_TAB[tab];

  // ── Suspend / terminate (super admin) ──────────────────────────────────────
  const [action, setAction] = useState(null); // { type, entityType, login_id, name, email }
  const [actionLoading, setActionLoading] = useState(false);

  const askAction = (type, entityType, row) => setAction({
    type,
    entityType,
    login_id: row.login_id,
    name: row.full_name || row.hospital_name || row.company_name || row.contact_name || row.email,
    email: row.email,
  });

  const runAction = async () => {
    if (!action) return;
    setActionLoading(true);
    try {
      const { data: res } = await API.post(
        `/api/admin/platform/${action.entityType}/${action.login_id}/action/`,
        { action: action.type }
      );
      toast.success(res?.message || 'Done!');
      if (res?.data?.email_sent) toast.success('📧 Email sent!');

      if (action.type === 'terminate') {
        // Drop the row from the directory right away — no page refresh needed.
        setRemovedIds((prev) => new Set(prev).add(action.login_id));
      }
      refetch();
      setAction(null);
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Action failed!');
    } finally {
      setActionLoading(false);
    }
  };

  const renderGenericTable = () => {
    if (rows.length === 0) return null;
    const sample = rows[0];
    const visibleKeys = Object.keys(sample).filter(
      (k) => !['login_id', 'role'].includes(k)
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); setModal({ type: 'generic', data: row }); }}
                      className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-600 hover:bg-primary-100 px-3 py-1 rounded-lg font-medium transition"
                    >
                      <FiEye className="w-3 h-3" /> View
                    </button>
                    {actionEntityType && (
                      <PlatformActionButtons row={row} entityType={actionEntityType} onAct={askAction} />
                    )}
                  </div>
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
        <p className="text-sm" style={{ color: '#666' }}>Browse hospitals, ambulance drivers, and equipment vendors</p>
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
                {data[key].filter((row) => !removedIds.has(row.login_id)).length}
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
        ) : (
          renderGenericTable()
        )}
      </div>

      {/* Modals */}
      {modal?.type === 'generic' && (
        <GenericModal item={modal.data} tabKey={tab} onClose={() => setModal(null)} />
      )}

      {/* Suspend / Terminate confirmation */}
      {action && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setAction(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-7" onClick={(e) => e.stopPropagation()}>
            <h3
              className="font-bold text-lg mb-1"
              style={{ color: action.type === 'resume' ? '#16A34A' : action.type === 'suspend' ? '#F97316' : '#EF4444' }}
            >
              {action.type === 'resume' ? '✅ Resume Account?' : action.type === 'suspend' ? '🔴 Suspend Account?' : '⛔ Terminate Account?'}
            </h3>
            <p className="text-sm text-gray-600 mb-1">
              You are about to {action.type} <strong className="text-black">{action.name}</strong>.
            </p>
            <p className="text-sm text-gray-500 mb-4">
              📧 A notification email will be sent to <strong>{action.email}</strong>.
            </p>
            <div
              className="rounded-xl px-4 py-3 mb-5 text-sm"
              style={
                action.type === 'resume'
                  ? { backgroundColor: '#F0FDF4', border: '1px solid #86EFAC', color: '#16A34A' }
                  : action.type === 'suspend'
                    ? { backgroundColor: '#FFF7ED', border: '1px solid #FED7AA', color: '#F97316' }
                    : { backgroundColor: '#FEF2F2', border: '1px solid #FCA5A5', color: '#EF4444' }
              }
            >
              {action.type === 'resume'
                ? '✅ The account will be reactivated and can access FederCare again.'
                : action.type === 'suspend'
                  ? '🔴 The account will be suspended — they cannot access FederCare until reactivated.'
                  : '⛔ The account will be permanently terminated and can no longer access FederCare.'}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setAction(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-200 bg-white"
              >
                Cancel
              </button>
              <button
                onClick={runAction}
                disabled={actionLoading}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: action.type === 'resume' ? '#22C55E' : action.type === 'suspend' ? '#F97316' : '#EF4444' }}
              >
                {actionLoading
                  ? 'Processing…'
                  : action.type === 'resume'
                    ? '✅ Yes, Resume'
                    : action.type === 'suspend'
                      ? '🔴 Yes, Suspend'
                      : '⛔ Yes, Terminate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default UsersPage;
