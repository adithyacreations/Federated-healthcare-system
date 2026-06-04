import { useState } from 'react';
import toast from 'react-hot-toast';
import { FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

const TYPE_BADGE = {
  Hospital:  'bg-blue-100   text-blue-700',
  Pharmacy:  'bg-orange-100 text-orange-700',
  Vendor:    'bg-indigo-100 text-indigo-700',
};

const TABS = ['All', 'Hospitals', 'Pharmacists', 'Vendors'];

const DetailRow = ({ label, value }) => (
  <div className="flex items-start justify-between py-2 border-b border-hairline last:border-0">
    <span className="text-sm text-muted font-medium w-1/3">{label}</span>
    <span className="text-sm text-ink font-medium w-2/3 text-right break-words">{value || 'N/A'}</span>
  </div>
);

const ApprovalsPage = () => {
  const approvals = useApi('/api/auth/pending-approvals/');
  const [activeTab, setActiveTab] = useState('All');
  const [processing, setProcessing] = useState({});
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const d = approvals.data || {};

  const allRows = (() => {
    const rows = [];
    (d.hospitals || []).forEach((h) =>
      rows.push({ login_id: h.login_id, name: h.hospital_name, type: 'Hospital', email: h.email, registered: h.created_at, raw: h })
    );
    (d.pharmacists || []).forEach((p) =>
      rows.push({ login_id: p.login_id, name: p.pharmacy_name, type: 'Pharmacy', email: p.email, registered: p.created_at, raw: p })
    );
    (d.vendors || []).forEach((v) =>
      rows.push({ login_id: v.login_id, name: v.company_name, type: 'Vendor', email: v.email, registered: v.created_at, raw: v })
    );
    return rows;
  })();

  const filtered = activeTab === 'All' ? allRows
    : activeTab === 'Hospitals'   ? allRows.filter((r) => r.type === 'Hospital')
    : activeTab === 'Pharmacists' ? allRows.filter((r) => r.type === 'Pharmacy')
    : allRows.filter((r) => r.type === 'Vendor');

  const act = async (loginId, action) => {
    setProcessing((p) => ({ ...p, [loginId]: action }));
    try {
      await API.post(`/api/auth/${action}/${loginId}/`);
      toast.success(action === 'approve' ? 'Approved and email sent!' : 'Rejected and email sent!');
      approvals.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || `${action} failed`);
    } finally {
      setProcessing((p) => { const n = { ...p }; delete n[loginId]; return n; });
    }
  };

  const openDetails = (row) => {
    setSelectedRequest(row);
    setShowDetailsModal(true);
  };

  const tabCounts = {
    All:         allRows.length,
    Hospitals:   (d.hospitals || []).length,
    Pharmacists: (d.pharmacists || []).length,
    Vendors:     (d.vendors || []).length,
  };

  const sel = selectedRequest?.raw || {};

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            Approvals <span style={{ color: '#F97316' }}>·</span> Queue
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Review and approve hospital, pharmacy, and vendor registrations</p>
        </div>
        <button
          onClick={approvals.refetch}
          className="inline-flex items-center gap-2 text-sm text-muted border border-hairline px-3 py-1.5 rounded-full hover:bg-orange-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${
              activeTab === tab ? 'bg-white text-orange-500 shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            {tab}
            {tabCounts[tab] > 0 && (
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                activeTab === tab ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-600'
              }`}>
                {tabCounts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-hairline overflow-hidden">
        {approvals.loading ? (
          <div className="p-10 text-center text-muted text-sm">Loading approvals…</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-muted font-medium">No pending approvals in this category.</div>
            <div className="text-gray-400 text-sm mt-1">Approved/rejected items will appear here.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-cream text-xs font-semibold text-muted uppercase tracking-wide text-left">
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Registered</th>
                  <th className="px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {filtered.map((r) => {
                  const busy = processing[r.login_id];
                  return (
                    <tr key={r.login_id} className="hover:bg-orange-50/40 transition">
                      <td className="px-5 py-3 font-semibold text-ink">{r.name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${TYPE_BADGE[r.type] || 'bg-gray-100 text-gray-600'}`}>
                          {r.type}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted">{r.email}</td>
                      <td className="px-5 py-3 text-gray-500 text-xs">{fmtDate(r.registered)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => openDetails(r)}
                            className="px-4 py-1.5 rounded-full text-xs font-medium border-2 border-black text-black hover:bg-black hover:text-white transition-all"
                          >
                            View Details
                          </button>
                          <button
                            onClick={() => act(r.login_id, 'approve')}
                            disabled={!!busy}
                            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-orange-500 text-white hover:bg-orange-600 transition disabled:opacity-50"
                          >
                            {busy === 'approve' ? 'Approving…' : 'Approve'}
                          </button>
                          <button
                            onClick={() => act(r.login_id, 'reject')}
                            disabled={!!busy}
                            className="px-4 py-1.5 rounded-full text-xs font-semibold bg-black text-white hover:bg-black/80 transition disabled:opacity-50"
                          >
                            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View Details modal */}
      {showDetailsModal && selectedRequest && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="rounded-2xl p-6 w-full max-w-lg" style={{ backgroundColor: '#FAF7F2' }}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bricolage font-extrabold text-xl text-ink">Request Details</h3>
              <button
                onClick={() => setShowDetailsModal(false)}
                className="w-8 h-8 rounded-full bg-black text-white flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <DetailRow label="Name" value={selectedRequest.name} />
              <DetailRow label="Type" value={selectedRequest.type} />
              <DetailRow label="Email" value={sel.email} />
              <DetailRow label="Registered" value={fmtDate(sel.created_at)} />

              {selectedRequest.type === 'Hospital' && (
                <>
                  <DetailRow label="Hospital Name" value={sel.hospital_name} />
                  <DetailRow label="Registration No" value={sel.registration_no} />
                  <DetailRow label="City" value={sel.city} />
                  <DetailRow label="State" value={sel.state} />
                  <DetailRow label="Contact Phone" value={sel.contact_phone} />
                </>
              )}
              {selectedRequest.type === 'Pharmacy' && (
                <>
                  <DetailRow label="Full Name" value={sel.full_name} />
                  <DetailRow label="Pharmacy Name" value={sel.pharmacy_name} />
                  <DetailRow label="License No" value={sel.license_no} />
                </>
              )}
              {selectedRequest.type === 'Vendor' && (
                <>
                  <DetailRow label="Company" value={sel.company_name} />
                  <DetailRow label="Contact Name" value={sel.contact_name} />
                  <DetailRow label="Tax ID" value={sel.tax_id} />
                </>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => { act(selectedRequest.login_id, 'approve'); setShowDetailsModal(false); }}
                className="flex-1 py-3 rounded-full font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-all"
              >
                Approve
              </button>
              <button
                onClick={() => { act(selectedRequest.login_id, 'reject'); setShowDetailsModal(false); }}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white hover:bg-black/80 transition-all"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ApprovalsPage;
