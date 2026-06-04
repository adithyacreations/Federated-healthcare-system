import { useState, useMemo } from 'react';
import toast from 'react-hot-toast';
import { FiRefreshCw } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

const STATUS_BADGE = {
  pending: 'bg-yellow-100 text-yellow-700',
  reviewed: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  dismissed: 'bg-gray-100 text-gray-600',
};

const REPLY_STATUSES = ['reviewed', 'resolved', 'dismissed'];

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
};

const ComplaintsManagePage = () => {
  const complaints = useApi('/api/patient/complaints/all/');

  const [showReplyModal, setShowReplyModal] = useState(false);
  const [selectedComplaint, setSelectedComplaint] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState('reviewed');
  const [sending, setSending] = useState(false);

  const list = complaints.data?.complaints || [];

  // Section 1 — complaints raised by patients (users).
  // Section 2 — complaints filed by hospitals (against vendors).
  const { userComplaints, hospitalComplaints } = useMemo(() => {
    const userC = [];
    const hospC = [];
    list.forEach((c) => {
      if (c.filed_by_hospital_id) hospC.push(c);
      else userC.push(c);
    });
    return { userComplaints: userC, hospitalComplaints: hospC };
  }, [list]);

  const openReply = (c) => {
    setSelectedComplaint(c);
    setReplyText(c.admin_response || '');
    setReplyStatus(c.status && c.status !== 'pending' ? c.status : 'reviewed');
    setShowReplyModal(true);
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const res = await API.post(
        `/api/patient/complaints/${selectedComplaint.complaint_id}/reply/`,
        { reply: replyText, status: replyStatus }
      );
      if (res.data?.success) {
        toast.success('Reply sent! Patient notified.');
        setShowReplyModal(false);
        setReplyText('');
        complaints.refetch();
      }
    } catch {
      toast.error('Failed to send reply!');
    } finally {
      setSending(false);
    }
  };

  const renderCard = (c) => (
    <div key={c.complaint_id} className="bg-white rounded-2xl border border-hairline p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold uppercase bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
              {c.complaint_type}
            </span>
            <span className="font-bricolage font-bold text-ink">{c.subject}</span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>
              {c.status}
            </span>
          </div>
          <div className="text-xs text-muted mt-1">
            {c.patient_name && `From: ${c.patient_name}`}
            {c.filed_by_hospital && `From: ${c.filed_by_hospital}`}
            {c.doctor_name && ` · Dr. ${c.doctor_name}`}
            {c.vendor_name && ` · ${c.vendor_name}`}
            {c.hospital_name && ` · ${c.hospital_name}`}
            {' · '}{fmtDate(c.created_at)}
          </div>
          <p className="text-sm text-muted mt-2">{c.description}</p>
          {c.patient_followup && (
            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-ink">
              <span className="font-medium text-gray-500">Follow-up:</span> {c.patient_followup}
            </div>
          )}
          {c.hospital_response && (
            <div className="mt-2 bg-gray-50 rounded-xl p-3 text-sm text-ink" style={{ borderLeft: '4px solid #000' }}>
              <span className="font-medium">Hospital response:</span> {c.hospital_response}
            </div>
          )}
          {c.admin_response && (
            <div className="mt-2 bg-orange-50 border border-orange-100 rounded-xl p-3 text-sm text-ink">
              <span className="font-medium text-orange-600">Your response:</span> {c.admin_response}
            </div>
          )}
        </div>
        {c.admin_response ? (
          <div
            className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed flex items-center gap-2 shrink-0"
            title="You have already replied to this complaint"
          >
            Replied
          </div>
        ) : (
          <button
            onClick={() => openReply(c)}
            className="px-4 py-2 rounded-full text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 transition-all shrink-0"
          >
            Reply
          </button>
        )}
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-bricolage text-3xl font-extrabold" style={{ color: '#101010', letterSpacing: '-0.02em' }}>
            Complaints <span style={{ color: '#F97316' }}>·</span> Inbox
          </h1>
          <p className="text-sm" style={{ color: '#666' }}>Review patient complaints and respond.</p>
        </div>
        <button
          onClick={complaints.refetch}
          className="inline-flex items-center gap-2 text-sm text-muted border border-hairline px-3 py-1.5 rounded-full hover:bg-orange-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {complaints.loading ? (
        <div className="bg-white rounded-2xl border border-hairline p-10 text-center text-muted text-sm">Loading…</div>
      ) : list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-hairline p-10 text-center text-muted text-sm">No complaints filed yet.</div>
      ) : (
        <>
          {/* Section 1 — User (patient) complaints */}
          <section className="mb-10">
            <h2 className="text-base font-bold text-ink mb-3">User Complaints</h2>
            {userComplaints.length === 0 ? (
              <div className="bg-white rounded-2xl border border-hairline p-8 text-center text-muted text-sm">No user complaints.</div>
            ) : (
              <div className="space-y-3">{userComplaints.map(renderCard)}</div>
            )}
          </section>

          {/* Section 2 — Hospital complaints (against vendors) */}
          <section>
            <h2 className="text-base font-bold text-ink mb-3">Hospital Complaints</h2>
            {hospitalComplaints.length === 0 ? (
              <div className="bg-white rounded-2xl border border-hairline p-8 text-center text-muted text-sm">No hospital complaints.</div>
            ) : (
              <div className="space-y-3">{hospitalComplaints.map(renderCard)}</div>
            )}
          </section>
        </>
      )}

      {/* Reply modal */}
      {showReplyModal && selectedComplaint && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
            <h3 className="font-bricolage font-extrabold text-xl text-ink mb-2">Reply to Complaint</h3>
            <p className="text-muted text-sm mb-4">{selectedComplaint.subject}</p>

            <div className="flex gap-2 mb-4">
              {REPLY_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setReplyStatus(s)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    replyStatus === s ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Type your response…"
              rows={4}
              className="w-full border border-hairline rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-orange-400"
            />

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSendReply}
                disabled={!replyText.trim() || sending}
                className="flex-1 py-3 rounded-full font-semibold text-white bg-orange-500 hover:bg-orange-600 disabled:opacity-50"
              >
                {sending ? 'Sending…' : 'Send Reply'}
              </button>
              <button
                onClick={() => { setShowReplyModal(false); setReplyText(''); }}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white hover:bg-black/80"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ComplaintsManagePage;
