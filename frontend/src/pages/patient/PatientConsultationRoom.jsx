import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

import API from '../../api/axios';
import useApi from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import ConsultationChat from '../../components/consultation/ConsultationChat';
import { cleanDoctorName } from '../../utils/nameUtils';

const PANELS = [
  { id: 'chat', label: '💬 Chat' },
  { id: 'ehr', label: '📋 EHR' },
  { id: 'prescriptions', label: '💊 Prescriptions' },
];

const JitsiFrame = ({ roomId, name }) => (
  <iframe
    title="Jitsi Meet"
    src={`https://meet.jit.si/${roomId}#userInfo.displayName="${encodeURIComponent(name || 'Patient')}"&config.prejoinPageEnabled=false`}
    allow="camera; microphone; fullscreen; display-capture; autoplay"
    style={{ width: '100%', height: '100%', border: 'none' }}
  />
);

/**
 * In-app patient video consultation room. Embeds the SAME Jitsi room as the
 * doctor — the room id is `federcare-<first 8 chars of consultation_id>`, exactly
 * how the backend builds `jitsi_room_id`, so both land in the same call. The
 * right panel carries Chat / EHR / Prescriptions for the patient's own records.
 */
export default function PatientConsultationRoom() {
  const { consultation_id: consultationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const [consultation, setConsultation] = useState(location.state?.consultation || null);
  const [activePanel, setActivePanel] = useState('chat');
  const [ehrCode, setEhrCode] = useState(null);
  const wallet = useApi('/api/patient/ehr-wallet/');

  // Generate a 30-min EHR consent code on entry so the patient can read it to
  // the doctor (who types it to unlock the EHR). Shown always, above the tabs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await API.post('/api/patient/qr-token/');
        if (!cancelled && data?.success) setEhrCode(data.data?.short_code || null);
      } catch { /* code is optional — the EHR tab still works without it */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const copyEhrCode = () => {
    if (!ehrCode) return;
    navigator.clipboard?.writeText(ehrCode);
    toast.success('EHR code copied!');
  };

  // Best-effort fetch for the doctor name / details when opened directly.
  useEffect(() => {
    if (consultation) return;
    (async () => {
      try {
        const { data } = await API.get('/api/patient/consultations/');
        const found = (data?.data?.consultations || []).find((c) => c.consultation_id === consultationId);
        if (found) setConsultation(found);
      } catch { /* video still works via the deterministic room id */ }
    })();
  }, [consultationId, consultation]);

  // Deterministic room id — matches the backend's jitsi_room_id construction,
  // so it's correct even before `consultation` loads.
  const roomId = consultation?.jitsi_room_id || `federcare-${consultationId.slice(0, 8)}`;
  const patientName = user?.full_name || 'Patient';

  const w = useMemo(() => wallet.data || {}, [wallet.data]);
  const diagnoses = useMemo(() => (w.diagnoses || []).slice(0, 8), [w]);
  const prescriptions = useMemo(() => (w.prescriptions || []), [w]);
  const allergies = w.allergies || [];

  const downloadRx = async (prescriptionId) => {
    if (!prescriptionId) return;
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
    } catch {
      toast.error('Download failed');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#111111', overflow: 'hidden' }}>
      {/* Video */}
      <div style={{ flex: 1, position: 'relative' }}>
        <JitsiFrame roomId={roomId} name={patientName} />
        <button
          onClick={() => navigate('/patient/consultations')}
          style={{
            position: 'absolute', top: 16, left: 16, zIndex: 100,
            backgroundColor: 'rgba(0,0,0,0.7)', color: 'white', border: 'none',
            borderRadius: 999, padding: '8px 16px', cursor: 'pointer', fontSize: 14,
          }}
        >
          ← Leave
        </button>
      </div>

      {/* Side panel */}
      <div style={{ width: 360, flexShrink: 0, backgroundColor: 'white', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #E5E5E5', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#F97316', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
            {(consultation?.doctor_name || 'D').charAt(0).toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>
              {cleanDoctorName(consultation?.doctor_name) || '—'}
            </p>
            <p style={{ margin: 0, color: '#666', fontSize: 12 }}>
              {consultation?.slot_date || ''} {consultation?.start_time?.slice(0, 5) || ''}
            </p>
          </div>
          <span style={{ marginLeft: 'auto', color: '#F97316', fontSize: 12, fontWeight: 600 }}>🔴 Live</span>
        </div>

        {/* EHR consent code — always visible (any tab) so the patient can read
            it to the doctor, who types it to unlock the EHR during the call. */}
        <div style={{ backgroundColor: '#FFF7ED', borderBottom: '1px solid #FED7AA', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 11, color: '#F97316', fontWeight: 700, margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Your EHR Code
            </p>
            <p style={{ fontSize: 20, fontWeight: 900, color: '#000', margin: 0, letterSpacing: '3px', fontFamily: 'monospace' }}>
              {ehrCode || '------'}
            </p>
          </div>
          <button
            onClick={copyEhrCode}
            disabled={!ehrCode}
            style={{ padding: '6px 14px', backgroundColor: '#F97316', color: 'white', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: ehrCode ? 'pointer' : 'default', opacity: ehrCode ? 1 : 0.6 }}
          >
            📋 Copy
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #E5E5E5' }}>
          {PANELS.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePanel(p.id)}
              style={{
                flex: 1, padding: '12px 6px', border: 'none', cursor: 'pointer', fontSize: 12,
                backgroundColor: activePanel === p.id ? '#FFF7ED' : 'white',
                color: activePanel === p.id ? '#F97316' : '#666',
                fontWeight: activePanel === p.id ? 700 : 500,
                borderBottom: activePanel === p.id ? '2px solid #F97316' : '2px solid transparent',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden', backgroundColor: '#FAF7F2' }}>
          {activePanel === 'chat' && (
            <div style={{ height: '100%' }}>
              <ConsultationChat consultationId={consultationId} sender="patient" senderName={patientName} />
            </div>
          )}

          {activePanel === 'ehr' && (
            <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
              {allergies.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#DC2626', margin: '0 0 8px' }}>⚠️ Allergies</p>
                  {allergies.map((a) => (
                    <div key={a.allergy_id} style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, padding: 10, marginBottom: 6 }}>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 13, color: '#B91C1C' }}>{a.allergen}</p>
                      {a.reaction && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#666' }}>{a.reaction}</p>}
                    </div>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 12, fontWeight: 700, color: '#101010', margin: '0 0 8px' }}>Recent Diagnoses</p>
              {diagnoses.length === 0 ? (
                <p style={{ fontSize: 12, color: '#999' }}>No diagnoses on record.</p>
              ) : diagnoses.map((d) => (
                <div key={d.record_id} style={{ background: 'white', border: '1px solid #E5E5E5', borderRadius: 10, padding: 10, marginBottom: 6 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{d.title || '—'}</p>
                  {d.content && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#666' }}>{d.content}</p>}
                </div>
              ))}
            </div>
          )}

          {activePanel === 'prescriptions' && (
            <div style={{ height: '100%', overflowY: 'auto', padding: 16 }}>
              {prescriptions.length === 0 ? (
                <p style={{ fontSize: 12, color: '#999' }}>No prescriptions yet.</p>
              ) : prescriptions.map((r) => (
                <div key={r.record_id} style={{ background: 'white', border: '1px solid #E5E5E5', borderRadius: 10, padding: 10, marginBottom: 6 }}>
                  <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{r.title || 'Prescription'}</p>
                  {r.content && <p style={{ margin: '2px 0 4px', fontSize: 11, color: '#666' }}>{r.content}</p>}
                  {r.prescription_id && (
                    <button
                      onClick={() => downloadRx(r.prescription_id)}
                      style={{ fontSize: 11, color: '#F97316', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      ↓ Download PDF
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
