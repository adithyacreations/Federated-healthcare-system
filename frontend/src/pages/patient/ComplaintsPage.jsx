import { useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { format } from 'date-fns';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { cleanDoctorName } from '../../utils/nameUtils';

// Identical container + header styling shared by both columns.
const cardStyle = {
  backgroundColor: 'white',
  borderRadius: '16px',
  border: '1px solid #E5E5E5',
  padding: '24px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
};
const headerStyle = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '20px' };
const headerTitleStyle = { fontWeight: 700, fontSize: '18px', color: '#000000', margin: 0 };

const statusBadgeStyle = (status) => {
  const palette = {
    reviewed: { backgroundColor: '#F0FDF4', color: '#16A34A' },
    resolved: { backgroundColor: '#F0FDF4', color: '#16A34A' },
    pending: { backgroundColor: '#FFF7ED', color: '#F97316' },
    dismissed: { backgroundColor: '#F3F4F6', color: '#6B7280' },
  };
  return {
    ...(palette[status] || palette.pending),
    fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
    textTransform: 'capitalize',
  };
};

// Avoid the "Dr. Dr." double prefix when the name already carries a title.
const formatDoctorName = (name) => {
  if (!name) return '';
  if (name.startsWith('Dr. Dr.')) return name.replace('Dr. Dr.', 'Dr.');
  if (name.startsWith('Dr.')) return name;
  return `Dr. ${name}`;
};

const emptyForm = { target: '', subject: '', description: '' };

const ComplaintsPage = () => {
  const doctors = useApi('/api/patient/doctors/');
  const complaints = useApi('/api/patient/complaints/');

  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [followupText, setFollowupText] = useState({}); // complaint_id -> text
  const [followupSending, setFollowupSending] = useState(null);

  const sendFollowup = async (complaintId) => {
    const text = (followupText[complaintId] || '').trim();
    if (!text) return toast.error('Write a follow-up message');
    setFollowupSending(complaintId);
    try {
      await API.post(`/api/patient/complaints/${complaintId}/followup/`, { reply: text });
      toast.success('Follow-up sent');
      setFollowupText((p) => ({ ...p, [complaintId]: '' }));
      complaints.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not send follow-up');
    } finally {
      setFollowupSending(null);
    }
  };

  const doctorList = doctors.data?.doctors || [];
  const complaintList = complaints.data?.complaints || [];

  const submit = async () => {
    if (!form.target) return toast.error('Select a doctor');
    if (!form.subject.trim() || !form.description.trim()) {
      return toast.error('Subject and description are required');
    }
    setSubmitting(true);
    try {
      const body = {
        complaint_type: 'doctor',
        subject: form.subject,
        description: form.description,
      };
      const doc = doctorList.find((d) => d.doctor_id === form.target);
      body.doctor_id = form.target;
      if (doc?.hospital_id) body.hospital_id = doc.hospital_id;
      await API.post('/api/patient/complaints/submit/', body);
      toast.success('Complaint submitted');
      setForm(emptyForm);
      complaints.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not submit complaint');
    } finally {
      setSubmitting(false);
    }
  };

  const safeFmt = (iso) => {
    if (!iso) return '—';
    try { return format(new Date(iso), 'dd MMM yyyy'); } catch { return iso; }
  };

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <motion.div variants={cardVariants} className="mb-6">
          <h1 className="font-bricolage text-3xl font-extrabold text-ink">Complaints</h1>
          <p className="text-muted mt-1">Raise and track complaints about doctors.</p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* LEFT — File a complaint form */}
          <motion.div variants={cardVariants} style={cardStyle}>
            <div style={headerStyle}>
              <span style={{ fontSize: '20px' }}>📝</span>
              <h2 style={headerTitleStyle}>File a Complaint Against Doctor</h2>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted block mb-1">Select doctor</label>
                <select
                  className="input-field"
                  value={form.target}
                  onChange={(e) => setForm({ ...form, target: e.target.value })}
                >
                  <option value="">— choose —</option>
                  {doctorList.map((d) => (
                    <option key={d.doctor_id} value={d.doctor_id}>{cleanDoctorName(d.full_name)} ({d.specialization})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Subject</label>
                <input
                  className="input-field"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  placeholder="Brief subject"
                />
              </div>
              <div>
                <label className="text-xs text-muted block mb-1">Description</label>
                <textarea
                  className="input-field h-24 resize-none"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Describe the issue in detail…"
                />
              </div>
              <button onClick={submit} disabled={submitting} className="btn-orange w-full disabled:opacity-60">
                {submitting ? 'Submitting…' : 'Submit Complaint'}
              </button>
            </div>
          </motion.div>

          {/* RIGHT — My complaints (identical container) */}
          <motion.div variants={cardVariants} style={cardStyle}>
            <div style={headerStyle}>
              <span style={{ fontSize: '20px' }}>📋</span>
              <h2 style={headerTitleStyle}>My Complaints</h2>
            </div>

            {complaints.loading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : complaintList.length === 0 ? (
              <p className="text-sm text-muted">No complaints filed yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {complaintList.map((c) => (
                  <div key={c.complaint_id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold uppercase bg-orange-50 text-orange-600 px-2 py-0.5 rounded-full">
                            {c.complaint_type}
                          </span>
                          <span className="font-bold text-black">{c.subject}</span>
                        </div>
                        <div className="text-xs text-muted mt-1">
                          {c.doctor_name && formatDoctorName(c.doctor_name)}
                          {c.vendor_name}
                          {' · '}{safeFmt(c.created_at)}
                        </div>
                        <p className="text-sm text-muted mt-1">{c.description}</p>
                      </div>
                      <span style={statusBadgeStyle(c.status)}>{c.status}</span>
                    </div>

                    {c.admin_response && (
                      <div style={{ backgroundColor: '#FFF7ED', borderLeft: '3px solid #F97316', borderRadius: '8px', padding: '12px 16px', marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: '#F97316', marginBottom: '4px' }}>Admin Response</p>
                        <p style={{ fontSize: '14px', color: '#333333', margin: 0 }}>{c.admin_response}</p>
                      </div>
                    )}
                    {c.hospital_response && (
                      <div style={{ backgroundColor: '#F9FAFB', borderLeft: '3px solid #000000', borderRadius: '8px', padding: '12px 16px', marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: '#000000', marginBottom: '4px' }}>Hospital Response</p>
                        <p style={{ fontSize: '14px', color: '#333333', margin: 0 }}>{c.hospital_response}</p>
                      </div>
                    )}
                    {c.patient_followup && (
                      <div style={{ backgroundColor: '#F9FAFB', border: '1px solid #E5E5E5', borderRadius: '8px', padding: '12px 16px', marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', fontWeight: 600, color: '#000000', marginBottom: '4px' }}>Your Follow-up</p>
                        <p style={{ fontSize: '14px', color: '#333333', margin: 0 }}>{c.patient_followup}</p>
                      </div>
                    )}

                    {/* Follow-up reply */}
                    {(c.admin_response || c.hospital_response) && (
                      <div style={{ marginTop: '12px' }}>
                        <input
                          value={followupText[c.complaint_id] || ''}
                          onChange={(e) => setFollowupText((p) => ({ ...p, [c.complaint_id]: e.target.value }))}
                          placeholder="Add a follow-up reply..."
                          style={{ width: '100%', border: '1px solid #E5E5E5', borderRadius: '12px', padding: '10px 14px', fontSize: '14px', outline: 'none' }}
                        />
                        <button
                          onClick={() => sendFollowup(c.complaint_id)}
                          disabled={followupSending === c.complaint_id}
                          style={{ width: '100%', padding: '14px', backgroundColor: '#F97316', color: 'white', border: 'none', borderRadius: '12px', fontWeight: 700, fontSize: '16px', cursor: 'pointer', marginTop: '8px', opacity: followupSending === c.complaint_id ? 0.5 : 1 }}
                        >
                          {followupSending === c.complaint_id ? 'Sending…' : 'Submit Reply'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>
      </motion.div>
    </DashboardLayout>
  );
};

export default ComplaintsPage;
