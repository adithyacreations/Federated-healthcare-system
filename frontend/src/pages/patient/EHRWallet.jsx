import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import {
  FiDownload, FiChevronDown, FiChevronUp, FiHome, FiPlus, FiShare2, FiUser,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import Modal from '../../components/common/Modal';
import FormInput from '../../components/auth/FormInput';
import AnimatedTabs from '../../components/patient/AnimatedTabs';
import AIHealthSummary from '../../components/patient/AIHealthSummary';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import { useAuth } from '../../context/AuthContext';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import { cleanDoctorName } from '../../utils/nameUtils';

const TAB_KEYS = [
  { key: 'all',           label: 'All' },
  { key: 'diagnoses',     label: 'Diagnoses' },
  { key: 'lab_reports',   label: 'Lab Reports' },
  { key: 'prescriptions', label: 'Prescriptions' },
  { key: 'history',       label: 'History' },
  { key: 'images',        label: 'Images' },
  { key: 'allergies',     label: 'Allergies' },
  { key: 'ai_summary',    label: '🧠 AI Summary' },
];

const IMAGE_TYPES = [
  { value: 'xray', label: 'X-Ray' },
  { value: 'mri', label: 'MRI Scan' },
  { value: 'skin', label: 'Skin Photo' },
  { value: 'ct_scan', label: 'CT Scan' },
  { value: 'ultrasound', label: 'Ultrasound' },
  { value: 'other', label: 'Other' },
];

// The inline uploader offers the four primary types; the grid below still
// groups every stored type (incl. CT / Ultrasound) so nothing is hidden.
const UPLOAD_TYPES = [
  { value: 'xray', emoji: '🫁', label: 'X-Ray', hint: 'X-Ray image' },
  { value: 'mri', emoji: '🧠', label: 'MRI Scan', hint: 'MRI scan image' },
  { value: 'skin', emoji: '🔬', label: 'Skin Photo', hint: 'skin photo' },
  { value: 'other', emoji: '📄', label: 'Other', hint: 'medical image' },
];

const SEVERITY_BADGE = { mild: 'badge-warning', moderate: 'badge-warning', severe: 'badge-danger' };
const TYPE_TO_TAB = {
  diagnoses: 'diagnosis', lab_reports: 'lab', prescriptions: 'prescription', history: 'history',
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try { return format(new Date(iso), 'dd MMM yyyy, HH:mm'); } catch { return iso; }
};

const recordTitle = (record) => {
  if (record?._cat === 'prescriptions' && record.doctor_name) {
    return `Prescription - ${cleanDoctorName(record.doctor_name)}`;
  }
  return record?.title || '-';
};

const sourceItems = (record) => {
  const items = [];
  if (record?.doctor_name) {
    items.push({ key: 'doctor', icon: FiUser, label: cleanDoctorName(record.doctor_name) });
  }
  if (record?.hospital_name) {
    items.push({ key: 'hospital', icon: FiHome, label: record.hospital_name });
  }
  return items;
};

const EHRWallet = () => {
  const { user } = useAuth();
  const wallet = useApi('/api/patient/ehr-wallet/');
  const images = useApi('/api/patient/ehr/images/');
  const [activeTab, setActiveTab] = useState('all');
  const [expanded, setExpanded] = useState({});
  const [showQR, setShowQR] = useState(false);
  const [qr, setQr] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [showAllergy, setShowAllergy] = useState(false);
  const [allergyForm, setAllergyForm] = useState({ allergen: '', reaction: '', severity: 'mild' });
  const [submitting, setSubmitting] = useState(false);

  const [lightbox, setLightbox] = useState(null);

  // Inline medical-image upload (X-Ray / MRI / Skin / Other). Patients upload and
  // view their own scans here; AI analysis of scans is a doctor-side tool.
  const [imageType, setImageType] = useState('xray');
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadingInline, setUploadingInline] = useState(false);
  const activeUploadType = UPLOAD_TYPES.find((t) => t.value === imageType) || UPLOAD_TYPES[3];

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setPreview(reader.result);
    reader.readAsDataURL(file);
  };

  const handleInlineUpload = async () => {
    if (!selectedFile) return toast.error('Please select an image!');
    setUploadingInline(true);
    try {
      const fd = new FormData();
      fd.append('image', selectedFile);
      fd.append('image_type', imageType);
      fd.append('description', uploadDesc);
      // Backend requires a non-empty title — fall back to the type label.
      fd.append('title', uploadDesc.trim() || activeUploadType.label);
      const { data } = await API.post('/api/patient/ehr/upload-image/', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (data?.success) {
        toast.success('Image uploaded ✅');
        setSelectedFile(null);
        setPreview(null);
        setUploadDesc('');
        images.refetch();
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Upload failed!');
    } finally {
      setUploadingInline(false);
    }
  };

  useEffect(() => {
    if (!qr) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [qr]);

  const remainingMs = qr ? Math.max(0, new Date(qr.expires_at).getTime() - now) : 0;
  const remaining = useMemo(() => {
    if (!qr) return '';
    const sec = Math.floor(remainingMs / 1000);
    const m = String(Math.floor(sec / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }, [qr, remainingMs]);

  const w = useMemo(() => wallet.data || {}, [wallet.data]);
  const allRecords = useMemo(() => {
    const tagged = [];
    ['diagnoses', 'lab_reports', 'prescriptions', 'history'].forEach((cat) => {
      (w[cat] || []).forEach((r) => tagged.push({ ...r, _cat: cat }));
    });
    return tagged.sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at));
  }, [w]);

  const records = activeTab === 'all'
    ? allRecords
    : (w[activeTab] || []).map((r) => ({ ...r, _cat: activeTab }));

  // Build tabs with dynamic counts from wallet + images data
  const TABS = useMemo(() => {
    const imgCount = images.data?.total || 0;
    const allergyCount = (w.allergies || []).length;
    return TAB_KEYS.map((t) => {
      let count;
      if (t.key === 'all') count = allRecords.length;
      else if (t.key === 'images') count = imgCount;
      else if (t.key === 'allergies') count = allergyCount;
      else if (t.key === 'ai_summary') count = null;
      else count = (w[t.key] || []).length;
      return {
        key: t.key,
        label: count != null ? `${t.label} (${count})` : t.label,
      };
    });
  }, [w, allRecords.length, images.data]);

  const requestQR = async () => {
    try {
      const { data } = await API.post('/api/patient/qr-token/');
      setQr(data?.data);
      setShowQR(true);
      setNow(Date.now());
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not generate QR');
    }
  };

  const revokeQR = () => {
    setQr(null);
    setShowQR(false);
    toast.success('QR access revoked');
  };

  const downloadPrescription = async (prescriptionId) => {
    if (!prescriptionId) return toast.error('Missing prescription id');
    try {
      const token = localStorage.getItem('access_token') || localStorage.getItem('token');
      const res = await fetch(
        `http://localhost:8000/api/doctor/prescriptions/${prescriptionId}/download/`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prescription_${prescriptionId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast.success('Prescription downloaded!');
    } catch (err) {
      console.error('Prescription download failed:', err);
      toast.error('Download failed');
    }
  };

  const addAllergy = async (e) => {
    e.preventDefault();
    if (!allergyForm.allergen) {
      toast.error('Allergen is required');
      return;
    }
    setSubmitting(true);
    try {
      await API.post('/api/patient/add-allergy/', allergyForm);
      toast.success('Allergy added');
      setShowAllergy(false);
      setAllergyForm({ allergen: '', reaction: '', severity: 'mild' });
      wallet.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to add');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const patientName = w.patient_name || user?.full_name || 'Your Health Wallet';

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* SECTION A — Health card */}
        <motion.section
          variants={cardVariants}
          className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 to-cream p-6 mb-6 flex flex-wrap items-center justify-between gap-6"
        >
          <div className="min-w-0">
            <h1 className="font-bricolage text-3xl font-extrabold text-ink truncate">{patientName}</h1>
            <p className="text-muted">Your lifelong health record — share via QR with consent.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              {w.blood_group && (
                <span className="bg-red-50 text-red-600 border border-red-100 px-3 py-1 rounded-full font-medium">🩸 {w.blood_group}</span>
              )}
              {w.age != null && (
                <span className="bg-white text-muted border border-hairline px-3 py-1 rounded-full font-medium">Age {w.age}</span>
              )}
              {w.bmi != null && (
                <span className="bg-green-50 text-green-600 border border-green-100 px-3 py-1 rounded-full font-medium">BMI {w.bmi}</span>
              )}
            </div>
          </div>
          <div className="bg-white border border-hairline rounded-2xl p-5 text-center">
            <div className="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center mx-auto mb-2">
              <FiShare2 className="w-6 h-6" />
            </div>
            <p className="text-sm text-muted mb-3">Share with your doctor</p>
            <button onClick={requestQR} className="btn-orange text-sm">Generate QR</button>
          </div>
        </motion.section>

        {/* SECTION B — Animated tabs */}
        <AnimatedTabs tabs={TABS} active={activeTab} onChange={setActiveTab} layoutId="ehr-tab" />

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial="hidden"
            animate="visible"
            exit="hidden"
            variants={pageVariants}
          >
            {/* AI Health Summary */}
            {activeTab === 'ai_summary' ? (
              <AIHealthSummary />
            ) : activeTab === 'images' ? (
              <section>
                {/* Inline upload section */}
                <div className="dashboard-card mb-6">
                  <h3 className="font-bricolage font-bold text-ink mb-3">⬆️ Upload Medical Image</h3>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {UPLOAD_TYPES.map((type) => (
                      <button
                        key={type.value}
                        onClick={() => { setImageType(type.value); setSelectedFile(null); setPreview(null); }}
                        className={`px-4 py-2 rounded-full text-sm font-semibold border-2 transition ${
                          imageType === type.value
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-muted border-hairline hover:border-orange-400'
                        }`}
                      >
                        {type.emoji} {type.label}
                      </button>
                    ))}
                  </div>

                  <label
                    htmlFor="ehr-inline-upload"
                    className="block border-2 border-dashed border-hairline rounded-2xl text-center cursor-pointer hover:border-orange-400 transition p-4"
                  >
                    <input id="ehr-inline-upload" type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                    {preview ? (
                      <div>
                        <img src={preview} alt="Preview" className="max-h-44 mx-auto rounded-lg object-contain" />
                        <p className="text-xs text-orange-500 mt-2">✅ {selectedFile?.name} — click to change</p>
                      </div>
                    ) : (
                      <div className="py-6">
                        <p className="text-4xl mb-2">{activeUploadType.emoji}</p>
                        <p className="font-semibold text-ink text-sm">Click to select {activeUploadType.hint}</p>
                        <p className="text-xs text-muted mt-1">JPG, PNG supported</p>
                      </div>
                    )}
                  </label>

                  <input
                    type="text"
                    value={uploadDesc}
                    onChange={(e) => setUploadDesc(e.target.value)}
                    placeholder="Add a note e.g. Chest X-Ray 2026 (optional)"
                    className="w-full mt-3 border border-hairline rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                  />

                  <button
                    onClick={handleInlineUpload}
                    disabled={!selectedFile || uploadingInline}
                    className="w-full mt-3 py-3 rounded-xl font-bold text-white disabled:cursor-not-allowed"
                    style={{ backgroundColor: selectedFile ? '#F97316' : '#E5E5E5' }}
                  >
                    {uploadingInline ? '⏳ Uploading…' : '⬆️ Upload Image'}
                  </button>
                </div>

                {/* Lab Reports — auto-saved by the lab when a test completes (read-only) */}
                {(images.data?.images_by_type?.lab_report?.length || 0) > 0 && (
                  <div className="mb-6">
                    <div className="rounded-xl px-4 py-3 mb-3" style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}>
                      <p className="text-[13px] font-semibold m-0" style={{ color: '#16A34A' }}>
                        📊 Lab reports are automatically saved here when your test is completed by the lab! ✅
                      </p>
                    </div>
                    <p className="text-xs uppercase tracking-wide text-muted mb-2">📊 Lab Reports</p>
                    <div className="space-y-2">
                      {images.data.images_by_type.lab_report.map((rep) => (
                        <div key={rep.image_id} className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-white px-4 py-3">
                          <div className="min-w-0">
                            <p className="font-medium text-sm text-ink truncate m-0">{rep.description || rep.title || 'Lab Report'}</p>
                            <p className="text-xs text-muted m-0">
                              📅 {rep.uploaded_at ? format(new Date(rep.uploaded_at), 'dd MMM yyyy') : '—'}
                              {rep.hospital_name ? ` · ${rep.hospital_name}` : ''}
                            </p>
                          </div>
                          <a
                            href={rep.image_url}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 px-4 py-2 rounded-lg text-xs font-semibold text-white"
                            style={{ backgroundColor: '#F97316' }}
                          >
                            View →
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {images.loading ? (
                  <div className="dashboard-card text-sm text-muted">Loading images…</div>
                ) : (images.data?.total || 0) === 0 ? (
                  <div className="dashboard-card text-sm text-muted text-center py-10">No medical images uploaded yet.</div>
                ) : (
                  IMAGE_TYPES.map((t) => {
                    const list = images.data?.images_by_type?.[t.value] || [];
                    if (list.length === 0) return null;
                    return (
                      <div key={t.value} className="mb-6">
                        <p className="text-xs uppercase tracking-wide text-muted mb-2">{t.label}</p>
                        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 [&>*]:mb-4">
                          {list.map((img) => (
                            <div key={img.image_id} className="break-inside-avoid rounded-2xl border border-hairline bg-white overflow-hidden group">
                              <div className="relative overflow-hidden">
                                <img
                                  src={img.image_url}
                                  alt={img.title}
                                  className="w-full object-cover bg-gray-100 transition-transform duration-300 group-hover:scale-105 cursor-zoom-in"
                                  onClick={() => setLightbox(img)}
                                />
                                <span className="absolute top-2 left-2 text-[10px] bg-ink/70 text-white px-2 py-0.5 rounded-full">{t.label}</span>
                              </div>
                              <div className="p-3">
                                <div className="font-medium text-sm text-ink truncate">{img.title}</div>
                                <div className="text-xs text-muted">
                                  {img.hospital_name || '—'}{img.scan_date ? ` · ${img.scan_date}` : ''}
                                </div>
                                <div className="flex gap-3 mt-2">
                                  <button onClick={() => setLightbox(img)} className="text-xs text-orange-500 hover:underline">View Full</button>
                                  <a href={img.image_url} download className="text-xs text-muted hover:underline">Download</a>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            ) : activeTab === 'allergies' ? (
              <section>
                {(w.allergies || []).length === 0 ? (
                  <div className="dashboard-card text-sm text-muted">No allergies recorded.</div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {w.allergies.map((a) => (
                      <motion.div key={a.allergy_id} variants={cardVariants} className="dashboard-card">
                        <div className="flex items-start justify-between mb-2">
                          <div className="font-bricolage font-bold text-ink">{a.allergen}</div>
                          <span className={SEVERITY_BADGE[a.severity] || 'badge-info'}>{a.severity}</span>
                        </div>
                        <p className="text-sm text-muted">{a.reaction || '—'}</p>
                        <p className="text-xs text-gray-400 mt-2">Noted: {fmtDate(a.noted_at)}</p>
                      </motion.div>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <section>
                {wallet.loading ? (
                  <div className="dashboard-card text-sm text-muted">Loading…</div>
                ) : records.length === 0 ? (
                  <div className="dashboard-card text-sm text-muted text-center py-10">No records in this category.</div>
                ) : (
                  <div className="space-y-3">
                    {records.map((r) => {
                      const isOpen = expanded[r.record_id];
                      const metaItems = sourceItems(r);
                      return (
                        <motion.div key={r.record_id} variants={cardVariants} className="dashboard-card">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <Badge status="info" text={TYPE_TO_TAB[r._cat] || r._cat} />
                                <span className="text-xs text-muted">{fmtDate(r.recorded_at)}</span>
                              </div>
                              <div className="font-bricolage font-bold text-ink">{recordTitle(r)}</div>
                              {metaItems.length > 0 && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                  {metaItems.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                      <span key={item.key} className="inline-flex items-center gap-1.5">
                                        <Icon className="w-3.5 h-3.5 text-orange-500" />
                                        {item.label}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                              {r.content && (
                                <p className={`text-sm text-muted mt-1 ${isOpen ? '' : 'line-clamp-2'}`}>{r.content}</p>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-2 shrink-0">
                              {r._cat === 'prescriptions' && r.prescription_id ? (
                                <button
                                  onClick={() => downloadPrescription(r.prescription_id)}
                                  className="text-orange-500 hover:underline text-sm inline-flex items-center gap-1"
                                >
                                  <FiDownload className="w-4 h-4" /> Download PDF
                                </button>
                              ) : (
                                r.file_url && (
                                  <a href={r.file_url} target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:underline text-sm inline-flex items-center gap-1">
                                    <FiDownload className="w-4 h-4" /> Download
                                  </a>
                                )
                              )}
                              <button onClick={() => toggle(r.record_id)} className="text-xs text-muted inline-flex items-center gap-1 hover:text-orange-500">
                                {isOpen ? <FiChevronUp /> : <FiChevronDown />}
                                {isOpen ? 'Collapse' : 'View Full'}
                              </button>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </section>
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Floating action — add allergy (image upload is inline in the Images tab) */}
      {activeTab === 'allergies' && (
        <button
          onClick={() => setShowAllergy(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-orange-500 text-white shadow-lg shadow-orange-500/30 flex items-center justify-center hover:bg-orange-600 transition"
          title="Add allergy"
        >
          <FiPlus className="w-6 h-6" />
        </button>
      )}

      {/* QR Share Modal */}
      <Modal isOpen={showQR && qr} onClose={() => setShowQR(false)} title="Share EHR via QR">
        <div className="text-center">
          {qr?.qr_code && <img src={qr.qr_code} alt="QR" className="mx-auto w-48 h-48 sm:w-56 sm:h-56 object-contain" />}
          <div className={`mt-4 inline-block px-4 py-2 rounded-full font-mono font-semibold ${
            remainingMs > 60_000 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
          }`}>
            Expires in {remaining}
          </div>

          {qr?.short_code && (
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-4 mt-4">
              <p className="text-sm text-orange-600 font-medium mb-2">📞 Tell this code to your doctor:</p>
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-center gap-2 sm:gap-3">
                <div className="flex gap-1 sm:gap-2">
                  {qr.short_code.split('').map((digit, i) => (
                    <span
                      key={i}
                      className="shrink-0 w-8 h-10 sm:w-10 sm:h-12 bg-white border-2 border-orange-300 rounded-xl flex items-center justify-center text-xl sm:text-2xl font-bricolage font-extrabold text-ink shadow-sm"
                    >
                      {digit}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => { navigator.clipboard?.writeText(qr.short_code); toast.success('Code copied!'); }}
                  className="bg-orange-500 text-white p-2 rounded-xl hover:bg-orange-600"
                >
                  📋
                </button>
              </div>
              <p className="text-xs text-muted mt-3">⏱️ Expires in: {remaining} · Valid for 30 minutes</p>
            </div>
          )}

          <div className="flex items-center gap-3 my-3">
            <hr className="flex-1 border-hairline" />
            <span className="text-muted text-sm">OR share token</span>
            <hr className="flex-1 border-hairline" />
          </div>

          {(qr?.token || qr?.consent_id) && (
            <div className="mt-2">
              <div className="flex items-center justify-center gap-2">
                <code className="bg-cream border border-hairline rounded-xl px-3 sm:px-4 py-2 text-ink font-mono text-xs sm:text-sm font-bold tracking-wider select-all break-all text-left max-h-24 overflow-y-auto">
                  {qr.token || qr.consent_id}
                </code>
                <button
                  onClick={() => { navigator.clipboard?.writeText(qr.token || qr.consent_id); toast.success('Token copied!'); }}
                  className="text-xs text-orange-500 underline shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted mt-3">
            Anyone scanning this QR can read your shared EHR data until it expires.
          </p>
          <button onClick={revokeQR} className="btn-danger w-full mt-4">Revoke Access</button>
        </div>
      </Modal>

      {/* Add Allergy Modal */}
      <Modal isOpen={showAllergy} onClose={() => setShowAllergy(false)} title="Add Allergy">
        <form onSubmit={addAllergy} className="space-y-4">
          <FormInput label="Allergen" placeholder="e.g. Penicillin" value={allergyForm.allergen}
            onChange={(e) => setAllergyForm({ ...allergyForm, allergen: e.target.value })} required />
          <FormInput label="Reaction" as="textarea" placeholder="Describe what happens"
            value={allergyForm.reaction}
            onChange={(e) => setAllergyForm({ ...allergyForm, reaction: e.target.value })} />
          <FormInput label="Severity" as="select" value={allergyForm.severity}
            onChange={(e) => setAllergyForm({ ...allergyForm, severity: e.target.value })}
            options={[
              { value: 'mild', label: 'Mild' },
              { value: 'moderate', label: 'Moderate' },
              { value: 'severe', label: 'Severe' },
            ]} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowAllergy(false)} className="btn-orange-outline">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-orange disabled:opacity-60">
              {submitting ? 'Saving…' : 'Save Allergy'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Image lightbox */}
      <Modal isOpen={Boolean(lightbox)} onClose={() => setLightbox(null)} title={lightbox?.title || ''} size="lg">
        {lightbox && (
          <div>
            <img src={lightbox.image_url} alt={lightbox.title} className="w-full max-h-[70vh] object-contain rounded-lg" />
            {lightbox.description && <p className="text-sm text-muted mt-3">{lightbox.description}</p>}
          </div>
        )}
      </Modal>

    </DashboardLayout>
  );
};

export default EHRWallet;
