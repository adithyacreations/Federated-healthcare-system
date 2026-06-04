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

const HospitalComplaintsPage = () => {
  const complaints = useApi('/api/patient/complaints/all/');

  const [selected, setSelected] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyStatus, setReplyStatus] = useState('reviewed');
  const [sending, setSending] = useState(false);

  const list = complaints.data?.complaints || [];

  // Section 1 — complaints filed by patients (about doctors in this hospital).
  // Section 2 — complaints this hospital filed against vendors.
  const { patientComplaints, myComplaints } = useMemo(() => {
    const patientC = [];
    const myC = [];
    list.forEach((c) => {
      if (c.filed_by_hospital_id) myC.push(c);
      else patientC.push(c);
    });
    return { patientComplaints: patientC, myComplaints: myC };
  }, [list]);

  const openReply = (c) => {
    setSelected(c);
    setReplyText(c.hospital_response || '');
    setReplyStatus(c.status && c.status !== 'pending' ? c.status : 'reviewed');
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      const res = await API.post(
        `/api/patient/complaints/${selected.complaint_id}/reply/`,
        { reply: replyText, status: replyStatus },
      );
      if (res.data?.success) {
        toast.success('Reply sent! Patient notified.');
        setSelected(null);
        setReplyText('');
        complaints.refetch();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to send reply!');
    } finally {
      setSending(false);
    }
  };

  const ComplaintCard = ({ c, canReply }) => (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold uppercase px-2 py-0.5 rounded-full" style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}>
              {c.complaint_type}
            </span>
            <span className="font-bold text-black">{c.subject}</span>
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_BADGE[c.status] || 'bg-gray-100 text-gray-600'}`}>
              {c.status}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {c.patient_name && `From: ${c.patient_name}`}
            {c.doctor_name && ` · Dr. ${c.doctor_name}`}
            {c.vendor_name && ` · ${c.vendor_name}`}
            {' · '}{fmtDate(c.created_at)}
          </div>
          <p className="text-sm text-gray-600 mt-2">{c.description}</p>

          {c.patient_followup && (
            <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-black">
              <span className="font-medium text-gray-500">Patient follow-up:</span> {c.patient_followup}
            </div>
          )}

          {c.admin_response && (
            <div className="mt-2 rounded-xl p-3 text-sm text-black" style={{ backgroundColor: '#FFF7ED', borderLeft: '4px solid #F97316' }}>
              <span className="font-medium" style={{ color: '#F97316' }}>Admin Response:</span> {c.admin_response}
            </div>
          )}
          {c.hospital_response && (
            <div className="mt-2 bg-gray-50 rounded-xl p-3 text-sm text-black" style={{ borderLeft: '4px solid #000' }}>
              <span className="font-medium">Hospital Response:</span> {c.hospital_response}
            </div>
          )}
        </div>

        {canReply && (
          c.admin_replied ? (
            <div
              className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed flex items-center gap-2 shrink-0"
              title="Admin has already replied. You cannot reply."
            >
              Admin Replied
            </div>
          ) : c.hospital_replied || c.hospital_response ? (
            <div
              className="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed flex items-center gap-2 shrink-0"
              title="You have already replied to this complaint"
            >
              Replied
            </div>
          ) : (
            <button
              onClick={() => openReply(c)}
              className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all shrink-0"
              style={{ backgroundColor: '#F97316' }}
            >
              Reply
            </button>
          )
        )}
      </div>
    </div>
  );

  return (
    <DashboardLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">Complaints</h1>
          <p className="text-sm text-gray-500">Respond to patient complaints and track vendor complaints you filed.</p>
        </div>
        <button
          onClick={complaints.refetch}
          className="inline-flex items-center gap-2 text-sm text-gray-600 border border-gray-200 px-3 py-1.5 rounded-full hover:bg-orange-50 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {complaints.loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-500 text-sm">Loading…</div>
      ) : (
        <>
          {/* Section 1 — Patient Complaints */}
          <section className="mb-10">
            <h2 className="text-base font-bold text-black mb-3">Patient Complaints</h2>
            {patientComplaints.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 text-sm">No patient complaints.</div>
            ) : (
              <div className="space-y-3">
                {patientComplaints.map((c) => (
                  <ComplaintCard key={c.complaint_id} c={c} canReply />
                ))}
              </div>
            )}
          </section>

          {/* Section 2 — My Complaints (filed against vendors) */}
          <section>
            <h2 className="text-base font-bold text-black mb-3">My Complaints (Filed Against Vendors)</h2>
            {myComplaints.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-500 text-sm">
                You haven't filed any vendor complaints. Use the Equipment Orders page to file one.
              </div>
            ) : (
              <div className="space-y-3">
                {myComplaints.map((c) => (
                  <ComplaintCard key={c.complaint_id} c={c} canReply={false} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Reply modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg">
            <h3 className="font-extrabold text-xl text-black mb-2">Reply to Complaint</h3>
            <p className="text-gray-500 text-sm mb-4">{selected.subject}</p>

            <div className="flex gap-2 mb-4">
              {REPLY_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setReplyStatus(s)}
                  className="px-4 py-2 rounded-full text-sm font-medium transition-all"
                  style={replyStatus === s
                    ? { backgroundColor: '#F97316', color: '#fff' }
                    : { backgroundColor: '#f3f4f6', color: '#4b5563' }}
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
              className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:border-orange-400"
            />

            <div className="flex gap-3 mt-4">
              <button
                onClick={handleSendReply}
                disabled={!replyText.trim() || sending}
                className="flex-1 py-3 rounded-full font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: '#F97316' }}
              >
                {sending ? 'Sending…' : 'Send Reply'}
              </button>
              <button
                onClick={() => { setSelected(null); setReplyText(''); }}
                className="flex-1 py-3 rounded-full font-semibold bg-black text-white"
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

export default HospitalComplaintsPage;
