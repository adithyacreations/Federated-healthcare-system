import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FiNavigation, FiPhone, FiClock, FiActivity, FiTruck, FiCalendar } from 'react-icons/fi';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import StatsCard from '../../components/dashboard/StatsCard';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import RouteLine from '../../components/common/RouteLine';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

// Fix Leaflet default icon paths broken by webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const patientIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const ambulanceIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const MovableMarker = ({ position, icon, label }) => {
  const map = useMap();
  useEffect(() => {
    if (position) map.panTo(position);
  }, [position, map]);
  if (!position) return null;
  return (
    <Marker position={position} icon={icon}>
      <Popup>{label}</Popup>
    </Marker>
  );
};

const severityBadge = (sev) => {
  const map = { HIGH: 'bg-orange-100 text-orange-700', CRITICAL: 'bg-red-100 text-red-700', MODERATE: 'bg-yellow-100 text-yellow-700' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${map[sev] || 'bg-gray-100 text-gray-600'}`}>{sev}</span>
  );
};

const DISPATCH_STATUSES = ['en_route', 'arrived', 'completed'];
const DISPATCH_LABELS = { en_route: 'En Route', arrived: 'Arrived', completed: 'Complete Trip' };

const DriverDashboard = () => {
  const { user } = useAuth();
  const [toggling, setToggling] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [ambulancePos, setAmbulancePos] = useState(null);
  const [sendingGps, setSendingGps] = useState(false);
  const [emergencyAlert, setEmergencyAlert] = useState(null);
  const [showAlert, setShowAlert] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const wsRef = useRef(null);

  const { data: dashData, refetch: refetchDash } = useApi('/api/emergency/dashboard/', { pollInterval: 10000 });
  const { data: dispatch, refetch: refetchDispatch } = useApi('/api/emergency/active-dispatch/', { pollInterval: 10000 });
  const { data: historyRaw } = useApi('/api/emergency/history/');

  const [tripStats, setTripStats] = useState({
    total_trips: 0,
    today_trips: 0,
    avg_response_time: 0,
  });
  useEffect(() => {
    const fetchTripStats = async () => {
      try {
        const res = await API.get('/api/emergency/driver/trip-stats/');
        if (res.data?.success) setTripStats(res.data.data);
      } catch (e) {
        /* best-effort */
      }
    };
    fetchTripStats();
    const id = setInterval(fetchTripStats, 60000);
    return () => clearInterval(id);
  }, []);

  const history = (historyRaw || []).slice(0, 5);
  const driverName = dashData?.driver_name || user?.full_name || 'Driver';
  const vehicleNo = dashData?.vehicle_no;
  const ambulanceType = dashData?.ambulance_type;
  const isAvailable = dashData?.is_available !== false;
  const totalTrips = tripStats.total_trips ?? dashData?.total_trips ?? (historyRaw || []).length;
  const todayTrips = tripStats.today_trips ?? dashData?.today_trips ?? 0;
  const avgResponseTime = tripStats.avg_response_time ?? 0;

  const connectWs = useCallback((dispatchId) => {
    if (!dispatchId) return;
    if (wsRef.current) wsRef.current.close();
    const ws = new WebSocket(`ws://localhost:8000/ws/gps/${dispatchId}/`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'gps_update' && msg.lat && msg.lng) {
          setAmbulancePos([parseFloat(msg.lat), parseFloat(msg.lng)]);
        }
      } catch {}
    };
    ws.onerror = () => {};
    wsRef.current = ws;
  }, []);

  useEffect(() => {
    if (dispatch?.id) connectWs(dispatch.id);
    return () => { if (wsRef.current) wsRef.current.close(); };
  }, [dispatch?.id, connectWs]);

  useEffect(() => {
    const loginId = user?.login_id;
    if (!loginId) return undefined;

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    let ws;
    try {
      ws = new WebSocket(`ws://localhost:8000/ws/emergency/${loginId}/`);
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }

        // Bed monitor re-routed us to a new hospital mid-trip.
        if (msg.type === 'bed_reroute') {
          toast(`🔄 ${msg.data.message}`, { duration: 6000, icon: '🏥' });
          refetchDispatch();
          return;
        }

        // Receiving hospital marked the bed prepared.
        if (msg.type === 'hospital_ready') {
          toast.success(`🏥 ${msg.data.message}`, { duration: 6000 });
          return;
        }

        if (msg.type !== 'emergency_dispatch') return;

        setEmergencyAlert(msg.data);
        setShowAlert(true);
        toast.error(`🚨 Emergency dispatch — ${msg.data.patient_name}`, { duration: 8000 });

        try {
          new Audio('/alert.mp3').play().catch(() => {});
        } catch { /* sound is best-effort */ }

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('🚨 Emergency Dispatch!', {
            body: `Patient: ${msg.data.patient_name} · ${msg.data.severity}`,
          });
        }

        refetchDash();
        refetchDispatch();
      };
      ws.onerror = () => { /* dashboard still works without the alert WS */ };
    } catch {
      /* WebSocket unavailable */
    }
    return () => { try { ws?.close(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.login_id]);

  const toggleAvailability = async () => {
    setToggling(true);
    try {
      const res = await API.put('/api/emergency/toggle-availability/', { is_available: !isAvailable });
      const nowAvailable = res.data?.data?.is_available;
      toast.success(nowAvailable ? '🟢 You are now Available' : '⚫ You are now Offline');
      refetchDash();
    } catch {
      toast.error('Update failed');
    } finally {
      setToggling(false);
    }
  };

  const acceptDispatch = async () => {
    const dispatchId = emergencyAlert?.dispatch_id;
    if (!dispatchId) { setShowAlert(false); return; }
    setAccepting(true);
    try {
      const res = await API.post(`/api/emergency/dispatch/${dispatchId}/accept/`);
      toast.success(res.data?.message || 'Dispatch accepted');
      setShowAlert(false);
      refetchDispatch();
      refetchDash();
    } catch {
      toast.error('Failed to accept dispatch');
    } finally {
      setAccepting(false);
    }
  };

  const rejectDispatch = async () => {
    const dispatchId = emergencyAlert?.dispatch_id;
    setShowAlert(false);
    if (!dispatchId) return;
    setRejecting(true);
    try {
      await API.post(`/api/emergency/dispatch/${dispatchId}/reject/`);
      toast('Dispatch declined — reassigning to the next driver', { icon: '🔄' });
      refetchDispatch();
      refetchDash();
    } catch {
      /* backend 60s timeout will reassign anyway */
    } finally {
      setRejecting(false);
    }
  };

  // 60-second response countdown for the active alert; auto-declines at zero.
  useEffect(() => {
    if (!showAlert || !emergencyAlert) return undefined;
    setCountdown(emergencyAlert.timeout_seconds || 60);
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          rejectDispatch();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAlert, emergencyAlert?.dispatch_id]);

  const updateDispatchStatus = async (status) => {
    if (!dispatch?.id) return;
    setUpdatingStatus(status);
    try {
      await API.put(`/api/emergency/dispatch/${dispatch.id}/status/`, { status });
      toast.success(`Status updated to ${status}`);
      refetchDispatch();
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
        try {
          await API.put('/api/emergency/update-gps/', { lat, lng, dispatch_id: dispatch?.id });
        } catch {}
        setSendingGps(false);
      },
      () => { toast.error('Could not get location'); setSendingGps(false); }
    );
  };

  const patientPos = dispatch?.patient_lat && dispatch?.patient_lng
    ? [parseFloat(dispatch.patient_lat), parseFloat(dispatch.patient_lng)]
    : null;
  const mapCenter = patientPos || ambulancePos || [9.0, 76.8];

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <DashboardHeader
          title="Driver Dashboard"
          subtitle={[driverName, vehicleNo, ambulanceType].filter(Boolean).join(' · ')}
          actions={
            dispatch ? (
              // Locked to a trip — show "On Duty" (the driver is busy, not offline).
              <span
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm border-2"
                style={{ backgroundColor: '#FFF7ED', color: '#F97316', borderColor: '#F97316' }}
              >
                <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: '#F97316' }} />
                On Duty
              </span>
            ) : (
              <button
                onClick={toggleAvailability}
                disabled={toggling}
                className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-semibold text-sm transition border-2 ${
                  isAvailable
                    ? 'bg-green-50 text-green-700 border-green-400'
                    : 'bg-gray-100 text-muted border-gray-300'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${isAvailable ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                {toggling ? '…' : isAvailable ? 'Available' : 'Unavailable'}
              </button>
            )
          }
        />

        {/* ─── Stats ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatsCard icon={FiTruck}    title="Total Trips"   value={totalTrips} />
          <StatsCard icon={FiCalendar} title="Today's Trips" value={todayTrips} />
          <StatsCard icon={FiClock}    title="Avg Response"  value={`${avgResponseTime} min`} />
          <StatsCard icon={FiActivity} title="Availability"  value={dispatch ? 'On Duty' : isAvailable ? 'Available' : 'Off Duty'} />
        </div>

        {/* ─── Active dispatch ───────────────────────────────────── */}
        <section className="mb-8">
          <h2 className="dash-h2">Active Dispatch</h2>
          {dispatch ? (
            <motion.div variants={cardVariants} className="rounded-2xl border-2 border-red-400 bg-red-50 p-5">
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
                  <div className="mt-1">{severityBadge(dispatch.severity)}</div>
                </div>
                <div className="bg-white rounded-xl p-3 border border-red-100">
                  <p className="text-xs text-muted">Hospital</p>
                  <p className="font-semibold text-sm text-ink">{dispatch.hospital_name || '—'}</p>
                </div>
                <div className="bg-white rounded-xl p-3 border border-red-100">
                  <p className="text-xs text-muted">Status</p>
                  <p className="font-semibold capitalize text-ink">{dispatch.status}</p>
                </div>
              </div>

              {/* Destination hospital + reserved bed */}
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
                <div
                  className="bg-orange-50 rounded-2xl border-2 p-4 text-center"
                  style={{ borderColor: '#FED7AA' }}
                >
                  <span className="text-4xl mb-3 block">🏥</span>
                  <p className="font-bold text-lg" style={{ color: '#F97316' }}>Waiting for Hospital</p>
                  <p className="text-gray-500 text-sm mt-1">
                    Hospital admin needs to acknowledge patient arrival.
                  </p>
                  <p className="text-xs text-gray-400 mt-2">
                    Your trip completes automatically once acknowledged.
                  </p>
                </div>
              ) : (
                <div className="flex gap-2 flex-wrap">
                  {DISPATCH_STATUSES.filter((s) => s !== dispatch.status).map((s) => (
                    <button
                      key={s}
                      disabled={updatingStatus === s}
                      onClick={() => updateDispatchStatus(s)}
                      className="px-4 py-2 rounded-full bg-orange-500 text-white hover:bg-orange-600 text-sm font-semibold disabled:opacity-50"
                    >
                      {updatingStatus === s ? '…' : DISPATCH_LABELS[s]}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="dashboard-card text-center py-8 text-muted">No active dispatch</div>
          )}
        </section>

        {/* ─── Live GPS map ──────────────────────────────────────── */}
        <motion.div variants={cardVariants} className="dashboard-card mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bricolage text-lg font-bold text-ink flex items-center gap-2">
              <FiNavigation className="text-orange-500" /> Live GPS Map
            </h2>
            <button onClick={updateMyLocation} disabled={sendingGps} className="btn-orange-outline text-sm">
              <FiNavigation className="w-4 h-4" />
              {sendingGps ? 'Locating…' : 'Update My Location'}
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ height: 380, position: 'relative', zIndex: 1 }}>
            {routeInfo && (
              <div className="absolute top-2 right-2 z-10 bg-white rounded-xl shadow-lg p-3 text-xs border border-hairline">
                <p className="font-bold text-orange-500">🗺️ Route Info</p>
                <p>📏 {routeInfo.distance}</p>
                <p>⏱️ ETA: {routeInfo.eta}</p>
              </div>
            )}
            <MapContainer center={mapCenter} zoom={13} style={{ height: '100%', width: '100%', zIndex: 1 }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap contributors"
              />
              {patientPos && <MovableMarker position={patientPos} icon={patientIcon} label="Patient Location" />}
              {ambulancePos && <MovableMarker position={ambulancePos} icon={ambulanceIcon} label="Ambulance" />}
              {patientPos && ambulancePos && (
                <RouteLine from={ambulancePos} to={patientPos} onRouteInfo={setRouteInfo} />
              )}
            </MapContainer>
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Patient location</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Ambulance</span>
          </div>
        </motion.div>

        {/* ─── Trip history ──────────────────────────────────────── */}
        <motion.div variants={cardVariants} className="dashboard-card">
          <h2 className="font-bricolage text-lg font-bold text-ink mb-4 flex items-center gap-2">
            <FiClock /> Trip History
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="text-left py-2 px-3 text-muted font-medium">Patient</th>
                  <th className="text-left py-2 px-3 text-muted font-medium">Hospital</th>
                  <th className="text-left py-2 px-3 text-muted font-medium">Date</th>
                  <th className="text-left py-2 px-3 text-muted font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-muted">No trips yet</td></tr>
                )}
                {history.map((trip) => (
                  <tr key={trip.dispatch_id} className="border-b border-hairline hover:bg-orange-50/40">
                    <td className="py-3 px-3 font-medium text-ink">{trip.emergency?.patient_name || '—'}</td>
                    <td className="py-3 px-3 text-muted">{trip.hospital_name || trip.emergency?.assigned_hospital || '—'}</td>
                    <td className="py-3 px-3 text-muted">
                      {trip.completed_at ? new Date(trip.completed_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="py-3 px-3 text-muted flex items-center gap-1">
                      <FiActivity className="w-3 h-3" /> {trip.eta_minutes ? `${trip.eta_minutes} min` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      </motion.div>

      {/* ─── Emergency dispatch alert ────────────────────────────── */}
      {showAlert && emergencyAlert && (
        <div className="fixed inset-0 z-50 bg-red-900/90 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md border-4 border-red-500 overflow-hidden">
            <div className="text-center pt-6 pb-3">
              <span className="text-5xl">🚨</span>
              <h2 className="font-bricolage text-2xl font-bold text-red-600 mt-2">EMERGENCY DISPATCH!</h2>
              <p className="text-sm mb-1" style={{ color: '#F97316' }}>
                {['critical', 'high'].includes(emergencyAlert.severity?.toLowerCase())
                  ? '⚡ Urgent! Respond within 60 seconds'
                  : emergencyAlert.severity?.toLowerCase() === 'moderate'
                  ? '⏱️ Respond within 3 minutes'
                  : '⏱️ Respond within 5 minutes'}
              </p>
              <p
                className={`text-4xl font-bold ${
                  countdown <= 10 ? 'text-red-600' : countdown <= 30 ? 'text-orange-500' : 'text-black'
                }`}
              >
                {countdown}s
              </p>
            </div>
            {/* Countdown bar */}
            <div className="h-2 bg-gray-100">
              <div
                className="h-full bg-red-500 transition-all duration-1000 ease-linear"
                style={{ width: `${(countdown / (emergencyAlert.timeout_seconds || 60)) * 100}%` }}
              />
            </div>
            <div className="p-6">
              <div className="bg-red-50 rounded-xl p-4 mb-4 space-y-1 text-sm">
                <p><b>Patient:</b> {emergencyAlert.patient_name}</p>
                <p><b>Severity:</b> <span className="text-red-600 font-bold">{emergencyAlert.severity}</span></p>
                {emergencyAlert.distance_km != null && (
                  <p><b>Distance:</b> {Number(emergencyAlert.distance_km).toFixed(1)} km</p>
                )}
                <p><b>Hospital:</b> {emergencyAlert.hospital_name}</p>
                {emergencyAlert.eta_minutes != null && (
                  <p><b>Est. Travel Time:</b> ~{emergencyAlert.eta_minutes} mins</p>
                )}
                {emergencyAlert.patient_phone && (
                  <p><b>Patient Contact:</b> {emergencyAlert.patient_phone}</p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={acceptDispatch}
                  disabled={accepting || rejecting}
                  className="flex-1 py-3 rounded-full font-bold text-white text-lg disabled:opacity-60"
                  style={{ backgroundColor: '#F97316' }}
                >
                  {accepting ? '…' : 'Accept'}
                </button>
                <button
                  onClick={rejectDispatch}
                  disabled={accepting || rejecting}
                  className="flex-1 py-3 rounded-full font-bold bg-black text-white text-lg disabled:opacity-60"
                >
                  {rejecting ? '…' : '❌ Reject'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default DriverDashboard;
