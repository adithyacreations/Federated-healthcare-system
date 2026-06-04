import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FiNavigation, FiPhone } from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';

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

const STATUSES = ['en_route', 'arrived', 'completed'];
const LABELS = { en_route: 'En Route', arrived: 'Arrived', completed: 'Complete Trip' };

const ActiveDispatchPage = () => {
  const { data: dispatch, refetch } = useApi('/api/emergency/active-dispatch/', { pollInterval: 10000 });
  const [ambulancePos, setAmbulancePos] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [sendingGps, setSendingGps] = useState(false);
  const wsRef = useRef(null);

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
      await API.put(`/api/emergency/dispatch/${dispatch.id}/status/`, { status });
      toast.success(`Status updated to ${status.replace('_', ' ')}`);
      refetch();
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

  return (
    <DashboardLayout>
      <DashboardHeader title="Active Dispatch" subtitle="Your current emergency assignment" />

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
                {dispatch.patient_phone && (
                  <a href={`tel:${dispatch.patient_phone}`} className="flex items-center gap-1 text-xs text-orange-500 mt-1">
                    <FiPhone className="w-3 h-3" /> {dispatch.patient_phone}
                  </a>
                )}
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
            ) : (
              <div className="flex gap-2 flex-wrap">
                {STATUSES.filter((s) => s !== dispatch.status).map((s) => (
                  <button
                    key={s}
                    disabled={updatingStatus === s}
                    onClick={() => updateStatus(s)}
                    className="px-4 py-2 rounded-full bg-orange-500 text-white hover:bg-orange-600 text-sm font-semibold disabled:opacity-50"
                  >
                    {updatingStatus === s ? '…' : LABELS[s]}
                  </button>
                ))}
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
        </>
      )}
    </DashboardLayout>
  );
};

export default ActiveDispatchPage;
