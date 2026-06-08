import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FiNavigation } from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const driverIcon = L.divIcon({
  html: '<div style="background:#3B82F6;color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 8px rgba(59,130,246,0.5);">🚑</div>',
  iconSize: [36, 36], iconAnchor: [18, 18], className: '',
});
const patientIcon = L.divIcon({
  html: '<div style="background:#F97316;color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 8px rgba(249,115,22,0.5);">👤</div>',
  iconSize: [36, 36], iconAnchor: [18, 18], className: '',
});
const hospitalIcon = L.divIcon({
  html: '<div style="background:#EF4444;color:#fff;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:3px solid #fff;box-shadow:0 4px 12px rgba(239,68,68,0.5);">🏥</div>',
  iconSize: [40, 40], iconAnchor: [20, 20], className: '',
});

// Guard against missing / out-of-range coordinates before drawing markers or routes.
const isValidCoord = (lat, lon) => (
  lat !== 0 && lon !== 0
  && !Number.isNaN(lat) && !Number.isNaN(lon)
  && lat >= -90 && lat <= 90
  && lon >= -180 && lon <= 180
);

// Fit the map to every available marker so driver, patient and hospital all
// stay framed — even when driver/patient sit at nearly the same point.
const FitBoundsToMarkers = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    const valid = positions.filter((p) => p && isValidCoord(p[0], p[1]));
    if (valid.length === 0) return;
    try {
      if (valid.length === 1) {
        map.setView(valid[0], 14);
      } else {
        map.fitBounds(L.latLngBounds(valid), { padding: [50, 50] });
      }
    } catch { /* bounds error — ignore */ }
  }, [map, positions]);
  return null;
};

const REPORT_TYPES = [
  { type: 'patient_not_found', icon: '👤', label: 'Patient Not Found', desc: 'No one at this location' },
  { type: 'patient_left', icon: '🚗', label: 'Patient Already Left', desc: 'Got another vehicle' },
  { type: 'fake_emergency', icon: '⚠️', label: 'Fake Emergency', desc: 'No real emergency here' },
  { type: 'wrong_location', icon: '📍', label: 'Wrong Location', desc: 'GPS location was incorrect' },
];

const ActiveDispatchPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dispatch, setDispatch] = useState(null);
  const [bedStatus, setBedStatus] = useState(null); // { beds_available, bed_warning } after arrival
  const [bedReadyInfo, setBedReadyInfo] = useState(null); // { bedNumber, ward, message }
  const [dispatchCancelled, setDispatchCancelled] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [ambulancePos, setAmbulancePos] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [sendingGps, setSendingGps] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportType, setReportType] = useState('');
  const [reportDesc, setReportDesc] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const wsRef = useRef(null);     // GPS socket (also used to push my location)
  const emWsRef = useRef(null);   // driver emergency socket (cancel pushes)
  const pollRef = useRef(null);
  const cancelledRef = useRef(false);

  // Patient cancelled / marked safe (or driver reported) → show overlay + leave.
  const handleEmergencyCancelled = useCallback((message) => {
    if (cancelledRef.current) return;
    cancelledRef.current = true;
    setCancelMessage(message || '');
    setDispatchCancelled(true);
    if (pollRef.current) clearInterval(pollRef.current);
    toast.success(message || '✅ Patient cancelled the emergency!');
    setTimeout(() => navigate('/driver/history'), 3000);
  }, [navigate]);

  // Manual fetch (not useApi) so we can read the top-level `cancelled` flag.
  const loadDispatch = useCallback(async () => {
    try {
      const res = await API.get('/api/emergency/active-dispatch/');
      if (res.data?.cancelled) { handleEmergencyCancelled(res.data.message); return; }
      const d = res.data?.data || null;
      setDispatch(d);
      // Persist the bed-ready banner across reloads/remounts (the hospital may
      // have prepared the bed while the driver was away from this screen).
      if (d?.bed_ready) {
        setBedReadyInfo((prev) => prev || {
          bedNumber: d.bed_type ? `${d.bed_ward || ''} ${d.bed_type}`.trim() : 'ready',
          ward: d.bed_ward || '',
          message: 'Hospital has prepared a bed for the patient.',
        });
      }
    } catch (err) {
      if (err.response?.status === 404) handleEmergencyCancelled('Emergency no longer active');
    }
  }, [handleEmergencyCancelled]);

  // Dual update system: poll every 4s (fallback) + driver emergency WS (instant).
  useEffect(() => {
    loadDispatch();
    pollRef.current = setInterval(loadDispatch, 4000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadDispatch]);

  useEffect(() => {
    const loginId = user?.login_id;
    if (!loginId) return undefined;
    let ws;
    try {
      ws = new WebSocket(`ws://localhost:8000/ws/emergency/${loginId}/`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'emergency_cancelled') {
            handleEmergencyCancelled(msg.data?.message);
          } else if (msg.type === 'bed_ready' || msg.type === 'hospital_ready') {
            const b = msg.data || {};
            setBedReadyInfo({
              bedNumber: b.bed_number || 'ready',
              ward: b.ward || '',
              message: b.message || 'Hospital has prepared a bed for the patient.',
            });
            toast.success(`🛏️ Bed ${b.bed_number || ''} is ready!`);
          }
        } catch { /* ignore */ }
      };
      ws.onerror = () => {};
      emWsRef.current = ws;
    } catch { /* ignore */ }
    return () => { try { ws?.close(); } catch { /* noop */ } };
  }, [user?.login_id, handleEmergencyCancelled]);

  const submitReport = async () => {
    if (!reportType) { toast.error('Select a reason!'); return; }
    if (!dispatch?.emergency_id) return;
    setSubmittingReport(true);
    try {
      await API.post(`/api/emergency/${dispatch.emergency_id}/driver-report/`, {
        report_type: reportType,
        description: reportDesc,
      });
      toast.success('Report submitted!');
      setShowReport(false);
      setReportType('');
      setReportDesc('');
      loadDispatch();
    } catch (e) {
      toast.error(e?.response?.data?.message || 'Failed to submit report!');
    } finally {
      setSubmittingReport(false);
    }
  };

  useEffect(() => {
    if (!dispatch?.id) return undefined;
    const ws = new WebSocket(`ws://localhost:8000/ws/gps/${dispatch.id}/`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'gps_update' && msg.lat && msg.lng) {
          setAmbulancePos([parseFloat(msg.lat), parseFloat(msg.lng)]);
        }
      } catch { /* ignore */ }
    };
    ws.onerror = () => {};
    wsRef.current = ws;
    return () => { try { ws.close(); } catch { /* noop */ } };
  }, [dispatch?.id]);

  const updateStatus = async (status) => {
    if (!dispatch?.id) return;
    setUpdatingStatus(status);
    try {
      const res = await API.put(`/api/emergency/dispatch/${dispatch.id}/status/`, { status });
      // Bug-1: on arrival the backend reports live bed availability — surface a
      // warning if the hospital has no bed ready for this patient.
      if (status === 'arrived') {
        const d = res.data?.data || {};
        if (d.bed_warning !== undefined) {
          setBedStatus({ beds_available: d.beds_available, bed_warning: d.bed_warning });
          if (d.bed_warning) {
            toast.error('⚠️ No beds available at hospital! They have been alerted.');
          }
        }
      }
      toast.success(`Status updated to ${status.replace('_', ' ')}`);
      loadDispatch();
    } catch {
      toast.error('Status update failed');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const updateMyLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation not supported'); return; }
    setSendingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setAmbulancePos([lat, lng]);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'gps_update', lat, lng, dispatch_id: dispatch?.id }));
        }
        try { await API.put('/api/emergency/update-gps/', { lat, lng, dispatch_id: dispatch?.id }); } catch { /* noop */ }
        setSendingGps(false);
      },
      () => { toast.error('Could not get location'); setSendingGps(false); },
    );
  };

  const patientLat = parseFloat(dispatch?.patient_lat ?? 0);
  const patientLng = parseFloat(dispatch?.patient_lng ?? 0);
  const patientPos = isValidCoord(patientLat, patientLng) ? [patientLat, patientLng] : null;

  const hosp = dispatch?.assigned_hospital;
  const hospitalLat = parseFloat(hosp?.lat || 0);
  const hospitalLon = parseFloat(hosp?.lon || 0);
  const hospitalPos = isValidCoord(hospitalLat, hospitalLon) ? [hospitalLat, hospitalLon] : null;

  // The driver's live GPS is the marker/route origin; fall back to the patient
  // point (the driver is there once 'arrived') so a route still draws before
  // any GPS ping arrives.
  const driverPos = ambulancePos || patientPos;

  // Before reaching the patient → route to patient; after pickup → route to hospital.
  const mapMode = ['arrived', 'pending_acknowledgment'].includes(dispatch?.status)
    ? 'to_hospital'
    : 'to_patient';

  const getAllMarkerPositions = () => (
    [driverPos, patientPos, hospitalPos].filter((p) => p && isValidCoord(p[0], p[1]))
  );

  const mapCenter = driverPos || patientPos || hospitalPos || [9.0, 76.8];

  // Strict trip flow: Mark Arrived → (hospital marks a bed ready) → Complete.
  // "Complete Trip" stays locked until the driver has arrived AND the hospital
  // has confirmed a prepared bed, so a patient is never handed over early.
  const hasArrived = ['arrived', 'pending_acknowledgment'].includes(dispatch?.status)
    || Boolean(dispatch?.arrived_at);
  const bedReady = Boolean(dispatch?.bed_ready) || Boolean(bedReadyInfo);

  return (
    <DashboardLayout>
      <DashboardHeader title="Active Dispatch" subtitle="Your current emergency assignment" />

      {/* Emergency-cancelled overlay (patient cancelled / marked safe) */}
      {dispatchCancelled && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-5" style={{ backgroundColor: 'rgba(0,0,0,0.8)' }}>
          <div className="bg-white rounded-2xl p-8 text-center w-full max-w-sm">
            <p style={{ fontSize: '48px', margin: 0 }}>✅</p>
            <h3 className="font-extrabold mb-3" style={{ color: '#22C55E' }}>Emergency Cancelled</h3>
            <p className="text-sm text-gray-600 mb-5" style={{ lineHeight: 1.5 }}>
              {cancelMessage || 'The patient has cancelled the emergency. They are safe.'}
              <br />Redirecting to trip history…
            </p>
            <div className="w-full h-1 rounded-full overflow-hidden" style={{ backgroundColor: '#E5E5E5' }}>
              <div style={{ width: '100%', height: '100%', backgroundColor: '#22C55E', borderRadius: '999px', animation: 'adShrink 3s linear forwards' }} />
            </div>
            <style>{'@keyframes adShrink { from { width: 100%; } to { width: 0%; } }'}</style>
          </div>
        </div>
      )}

      {!dispatch ? (
        <div className="dashboard-card text-center py-12">
          <span className="text-5xl block mb-3">🚑</span>
          <p className="font-semibold text-gray-700">No active dispatch</p>
          <p className="text-sm text-gray-400 mt-1">You'll see your assignment here when an emergency is accepted.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border-2 border-red-400 bg-red-50 p-5 mb-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="bg-white rounded-xl p-3 border border-red-100">
                <p className="text-xs text-muted">Patient</p>
                <p className="font-semibold text-ink">{dispatch.patient_name}</p>
              </div>
              <div className="bg-white rounded-xl p-3 border border-red-100">
                <p className="text-xs text-muted">Severity</p>
                <p className="font-bold text-ink mt-1">{dispatch.severity}</p>
              </div>
              <div className="bg-white rounded-xl p-3 border border-red-100">
                <p className="text-xs text-muted">ETA</p>
                <p className="font-semibold text-ink mt-1">{dispatch.eta_minutes ?? '—'} min</p>
              </div>
              <div className="bg-white rounded-xl p-3 border border-red-100">
                <p className="text-xs text-muted">Status</p>
                <p className="font-semibold capitalize text-ink mt-1">{String(dispatch.status).replace('_', ' ')}</p>
              </div>
            </div>

            {/* Patient direct-call card */}
            {dispatch.patient_phone ? (
              <div
                className="rounded-2xl p-4 mb-4 flex items-center justify-between"
                style={{ backgroundColor: '#F0FDF4', border: '1px solid #86EFAC' }}
              >
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide mb-1" style={{ color: '#16A34A' }}>
                    📞 Patient Contact
                  </p>
                  <p className="font-bold text-base text-black m-0">{dispatch.patient_name || 'Patient'}</p>
                  <p className="font-extrabold text-lg m-0" style={{ color: '#16A34A', letterSpacing: '1px' }}>
                    {dispatch.patient_phone}
                  </p>
                </div>
                <a
                  href={`tel:${dispatch.patient_phone}`}
                  className="flex items-center justify-center"
                  style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    backgroundColor: '#22C55E', textDecoration: 'none', fontSize: '24px',
                    boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
                  }}
                >
                  📞
                </a>
              </div>
            ) : (
              <div
                className="rounded-xl px-4 py-3 mb-4"
                style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}
              >
                <p className="text-xs m-0" style={{ color: '#F97316' }}>
                  ⚠️ Patient phone not available. Contact the hospital if needed.
                </p>
              </div>
            )}

            {dispatch.assigned_hospital?.name && (
              <div className="bg-white rounded-xl p-4 border border-gray-100 mb-4">
                <p className="text-xs text-gray-500 mb-1">🏥 Destination Hospital</p>
                <p className="font-bold text-ink">{dispatch.assigned_hospital.name}</p>
                {dispatch.assigned_hospital.address && (
                  <p className="text-sm text-gray-500">{dispatch.assigned_hospital.address}</p>
                )}
                <p className="text-xs mt-1" style={{ color: '#F97316' }}>🛏️ {dispatch.bed_info}</p>
                {dispatch.rerouted && (
                  <div className="mt-2 bg-orange-50 rounded-xl p-2">
                    <p className="text-xs font-medium" style={{ color: '#F97316' }}>
                      🔄 Rerouted {dispatch.reroute_count}× — bed was taken at a previous hospital
                    </p>
                  </div>
                )}
              </div>
            )}

            {dispatch.status === 'pending_acknowledgment' ? (
              <div className="bg-orange-50 rounded-2xl border-2 p-4 text-center" style={{ borderColor: '#FED7AA' }}>
                <span className="text-4xl mb-3 block">🏥</span>
                <p className="font-bold text-lg" style={{ color: '#F97316' }}>Waiting for Hospital</p>
                <p className="text-gray-500 text-sm mt-1">Hospital admin needs to acknowledge patient arrival.</p>
              </div>
            ) : !hasArrived ? (
              // Step 1 — must mark arrival at the destination first.
              <button
                disabled={updatingStatus === 'arrived'}
                onClick={() => updateStatus('arrived')}
                className="w-full sm:w-auto px-6 py-3 rounded-full text-white text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: '#F97316' }}
              >
                {updatingStatus === 'arrived' ? '…' : '📍 Mark Arrived at Location'}
              </button>
            ) : bedReady ? (
              // Step 2b — hospital confirmed a prepared bed → completion unlocked.
              <button
                disabled={updatingStatus === 'completed'}
                onClick={() => updateStatus('completed')}
                className="w-full sm:w-auto px-6 py-3 rounded-full text-white text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: '#22C55E' }}
              >
                {updatingStatus === 'completed' ? '…' : '✅ Complete Trip'}
              </button>
            ) : (
              // Step 2a — arrived, but waiting for the hospital to ready a bed.
              <div>
                <div
                  className="rounded-xl px-4 py-3 mb-2.5"
                  style={{ backgroundColor: '#FFF7ED', border: '1px solid #FED7AA' }}
                >
                  <p className="text-[13px] font-bold m-0" style={{ color: '#F97316' }}>
                    ⏳ Waiting for Hospital
                  </p>
                  <p className="text-xs text-gray-500 m-0 mt-0.5">
                    The hospital must mark a bed ready before you can complete the trip.
                  </p>
                </div>
                <button
                  disabled
                  className="w-full sm:w-auto px-6 py-3 rounded-full text-sm font-bold cursor-not-allowed"
                  style={{ backgroundColor: '#E5E5E5', color: '#9CA3AF' }}
                >
                  🔒 Complete Trip (waiting for bed)
                </button>
              </div>
            )}

            {/* Bed-ready banner — hospital prepared a bed for the patient */}
            {bedReadyInfo && (
              <div
                style={{
                  backgroundColor: '#F0FDF4',
                  borderRadius: '12px',
                  padding: '16px',
                  marginTop: '12px',
                  border: '2px solid #22C55E',
                }}
              >
                <p style={{ fontWeight: 800, color: '#16A34A', fontSize: '15px', margin: '0 0 4px' }}>
                  🛏️ Bed Ready!
                </p>
                <p style={{ color: '#166534', fontSize: '13px', margin: 0 }}>
                  Bed {bedReadyInfo.bedNumber}
                  {bedReadyInfo.ward ? ` — ${bedReadyInfo.ward}` : ''}
                  {' '}is prepared for the patient.
                </p>
              </div>
            )}

            {/* Bug-1: bed availability warning shown after the driver arrives */}
            {bedStatus?.bed_warning && (
              <div
                style={{
                  backgroundColor: '#FEF2F2',
                  borderRadius: '12px',
                  padding: '16px',
                  marginTop: '12px',
                  border: '2px solid #FCA5A5',
                }}
              >
                <p style={{ fontWeight: 800, color: '#EF4444', fontSize: '15px', margin: '0 0 6px' }}>
                  ⚠️ No Beds Available!
                </p>
                <p style={{ color: '#666', fontSize: '13px', margin: 0, lineHeight: 1.5 }}>
                  The hospital has been alerted. Please wait for their instructions
                  or contact the hospital directly before proceeding.
                </p>
              </div>
            )}
            {bedStatus && !bedStatus.bed_warning && bedStatus.beds_available != null && (
              <div
                style={{
                  backgroundColor: '#F0FDF4',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  marginTop: '12px',
                  border: '1px solid #86EFAC',
                }}
              >
                <p style={{ fontWeight: 700, color: '#16A34A', fontSize: '13px', margin: 0 }}>
                  ✅ Bed ready — {bedStatus.beds_available} bed(s) available at the hospital.
                </p>
              </div>
            )}

            {/* Incident report — patient not at the scene */}
            {dispatch.status === 'arrived' && (
              <div className="bg-white rounded-xl p-3 border border-gray-100 mt-3">
                <p className="text-xs text-gray-500 mb-2">Patient not at this location?</p>
                <button
                  onClick={() => setShowReport(true)}
                  className="w-full py-2.5 rounded-xl font-bold text-sm"
                  style={{ backgroundColor: '#FEF2F2', color: '#EF4444', border: '1.5px solid #FCA5A5' }}
                >
                  👤 Report Incident (Patient Not Found)
                </button>
              </div>
            )}
          </div>

          <div className="dashboard-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bricolage text-lg font-bold text-ink flex items-center gap-2">
                <FiNavigation className="text-orange-500" /> Live GPS Map
              </h2>
              <button onClick={updateMyLocation} disabled={sendingGps} className="btn-orange-outline text-sm">
                <FiNavigation className="w-4 h-4" /> {sendingGps ? 'Locating…' : 'Update My Location'}
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ position: 'relative', zIndex: 1 }}>
              {/* Mode indicator badge — centered on top of the map. */}
              <div
                style={{
                  position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
                  zIndex: 1000, background: 'white', borderRadius: '999px', padding: '6px 16px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: '13px', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {mapMode === 'to_patient' ? (
                  <>
                    <span style={{ width: '8px', height: '8px', background: '#F97316', borderRadius: '50%', animation: 'pulse 1s infinite' }} />
                    🚑 En Route to Patient
                  </>
                ) : (
                  <>
                    <span style={{ width: '8px', height: '8px', background: '#22C55E', borderRadius: '50%', animation: 'pulse 1s infinite' }} />
                    🏥 En Route to Hospital
                  </>
                )}
              </div>

              <MapContainer center={mapCenter} zoom={13} style={{ height: '400px', width: '100%', zIndex: 1 }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />

                {/* Auto-fit to every marker present. */}
                <FitBoundsToMarkers positions={getAllMarkerPositions()} />

                {/* Driver (blue ambulance). */}
                {driverPos && (
                  <Marker position={driverPos} icon={driverIcon}>
                    <Popup>🚑 Your Location</Popup>
                  </Marker>
                )}

                {/* Patient (orange person). */}
                {patientPos && (
                  <Marker position={patientPos} icon={patientIcon}>
                    <Popup>👤 {dispatch?.patient_name || 'Patient'}</Popup>
                  </Marker>
                )}

                {/* Hospital (red cross). */}
                {hospitalPos && (
                  <Marker position={hospitalPos} icon={hospitalIcon}>
                    <Popup>
                      🏥 {hosp?.name || 'Destination Hospital'}
                      {dispatch?.bed_info && (<><br /><small>🛏️ {dispatch.bed_info}</small></>)}
                    </Popup>
                  </Marker>
                )}

                {/* Route to patient — orange. */}
                {mapMode === 'to_patient' && driverPos && patientPos && (
                  <Polyline
                    positions={[driverPos, patientPos]}
                    pathOptions={{ color: '#F97316', weight: 5, opacity: 0.9, dashArray: '10 5' }}
                  />
                )}

                {/* Route to hospital — green. */}
                {mapMode === 'to_hospital' && driverPos && hospitalPos && (
                  <Polyline
                    positions={[driverPos, hospitalPos]}
                    pathOptions={{ color: '#22C55E', weight: 5, opacity: 0.9, dashArray: '10 5' }}
                  />
                )}
              </MapContainer>
            </div>

            {/* Map legend. */}
            <div
              style={{
                display: 'flex', gap: '16px', padding: '8px 12px', background: 'white',
                borderTop: '1px solid #E5E5E5', fontSize: '12px', borderRadius: '0 0 12px 12px',
              }}
            >
              <span>🚑 You</span>
              <span>👤 Patient</span>
              {hospitalPos && <span>🏥 Hospital</span>}
              <span style={{ marginLeft: 'auto', color: mapMode === 'to_patient' ? '#F97316' : '#22C55E' }}>
                {mapMode === 'to_patient' ? '🟠 Routing to patient' : '🟢 Routing to hospital'}
              </span>
            </div>
          </div>

          {/* Driver incident report modal */}
          {showReport && (
            <div
              className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-5"
              onClick={() => setShowReport(false)}
            >
              <div
                className="bg-white rounded-2xl p-6 w-full max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="font-extrabold mb-4">⚠️ Report Incident</h3>
                <p className="text-[13px] font-semibold text-gray-700 mb-2">What happened?</p>
                {REPORT_TYPES.map((opt) => (
                  <button
                    key={opt.type}
                    onClick={() => setReportType(opt.type)}
                    className="w-full flex items-center gap-2.5 text-left p-3 mb-2 rounded-lg"
                    style={{
                      backgroundColor: reportType === opt.type ? '#FEF2F2' : 'white',
                      border: `1.5px solid ${reportType === opt.type ? '#EF4444' : '#E5E5E5'}`,
                    }}
                  >
                    <span style={{ fontSize: '20px' }}>{opt.icon}</span>
                    <div>
                      <p
                        className="font-semibold text-[13px] m-0"
                        style={{ color: reportType === opt.type ? '#EF4444' : '#333' }}
                      >
                        {opt.label}
                      </p>
                      <p className="text-[11px] text-gray-400 m-0">{opt.desc}</p>
                    </div>
                  </button>
                ))}
                <textarea
                  value={reportDesc}
                  onChange={(e) => setReportDesc(e.target.value)}
                  placeholder="Additional details (optional)…"
                  rows={3}
                  className="w-full p-2.5 mt-2 mb-3 rounded-lg text-[13px] outline-none resize-none"
                  style={{ border: '1.5px solid #E5E5E5', boxSizing: 'border-box' }}
                />
                <div className="flex gap-2.5">
                  <button
                    onClick={() => { setShowReport(false); setReportType(''); }}
                    className="flex-1 py-3 rounded-xl font-semibold bg-white"
                    style={{ border: '1px solid #E5E5E5' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitReport}
                    disabled={!reportType || submittingReport}
                    className="py-3 rounded-xl font-bold text-white disabled:cursor-not-allowed"
                    style={{ flex: 2, backgroundColor: reportType ? '#EF4444' : '#E5E5E5' }}
                  >
                    {submittingReport ? '⏳ Submitting…' : '📋 Submit Report'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  );
};

export default ActiveDispatchPage;
