import { Component, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { FiPhone, FiNavigation, FiClock, FiTruck } from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import RouteLine from '../../components/common/RouteLine';
import useApi from '../../hooks/useApi';

// Fix Leaflet icon paths
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

const hospitalIcon = L.divIcon({
  html: '<div style="background:#EF4444;color:#fff;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);">🏥</div>',
  iconSize: [36, 36],
  iconAnchor: [18, 18],
  className: '',
});

// Catches any synchronous render error from the Leaflet map subtree so a map
// hiccup never blanks the whole tracker. (Async LRM errors are handled inside
// RouteLine; this is defence-in-depth for render-time failures.)
class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.log('Map error caught:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-64 bg-gray-100 rounded-2xl flex items-center justify-center">
          <div className="text-center">
            <p className="text-gray-500">Map temporarily unavailable</p>
            <button
              onClick={() => this.setState({ hasError: false })}
              className="mt-2 text-sm underline"
              style={{ color: '#F97316' }}
            >
              Reload map
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const LiveMarker = ({ position, icon, label }) => {
  const map = useMap();
  useEffect(() => {
    if (position) map.panTo(position, { animate: true });
  }, [position, map]);
  if (!position) return null;
  return (
    <Marker position={position} icon={icon}>
      <Popup>{label}</Popup>
    </Marker>
  );
};

const statusColor = {
  pending: 'bg-yellow-100 text-yellow-700',
  assigned: 'bg-blue-100 text-blue-700',
  dispatched: 'bg-blue-100 text-blue-700',
  en_route: 'bg-purple-100 text-purple-700',
  arrived: 'bg-orange-100 text-orange-700',
  pending_acknowledgment: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
};

// Friendly message keyed by the effective status (dispatch status preferred).
const STATUS_MESSAGE = {
  pending: { text: '🔍 Finding nearest ambulance…', sub: 'Please stay calm — help is being arranged.' },
  dispatched: { text: '📡 Ambulance assigned — awaiting driver', sub: 'The nearest driver has been alerted.' },
  en_route: { text: '🚑 Ambulance is on the way!', sub: 'Driver accepted your request.' },
  arrived: { text: '✅ Ambulance has arrived!', sub: 'Help is at your location.' },
  pending_acknowledgment: { text: '🏥 Arriving at hospital', sub: 'You will be safe soon.' },
  completed: { text: '🏥 Safely delivered to hospital', sub: 'Get well soon!' },
};

const EmergencyTracker = () => {
  const { emergency_id } = useParams();
  const navigate = useNavigate();
  const [ambulancePos, setAmbulancePos] = useState(null);
  const [eta, setEta] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const wsRef = useRef(null);

  // Poll status every 5s so the patient sees updates without refreshing.
  const { data: emergency, loading } = useApi(
    `/api/patient/emergency/${emergency_id}/`, { pollInterval: 5000 },
  );

  const dispatchId = emergency?.dispatch?.id;
  const acceptedAt = emergency?.dispatch?.accepted_at;
  const etaMinutes = emergency?.dispatch?.eta_minutes;

  // ETA countdown is anchored to ACCEPTED_AT (when the driver accepted), not
  // dispatch creation — so it only starts once a driver is en route, shows the
  // full ETA at that moment, and survives refresh (the anchor lives on server).
  useEffect(() => {
    if (!acceptedAt || !etaMinutes) {
      setEta(null);
      return undefined;
    }
    const arrivalMs = new Date(acceptedAt).getTime() + Number(etaMinutes) * 60000;
    const tick = () => setEta(Math.max(0, Math.floor((arrivalMs - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [acceptedAt, etaMinutes]);

  // WebSocket for live ambulance GPS
  useEffect(() => {
    if (!dispatchId) return;
    const ws = new WebSocket(`ws://localhost:8000/ws/gps/${dispatchId}/`);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'gps_update' && msg.lat && msg.lng) {
          setAmbulancePos([parseFloat(msg.lat), parseFloat(msg.lng)]);
          if (typeof msg.eta_minutes === 'number') setEta(msg.eta_minutes * 60);
        }
      } catch {}
    };
    ws.onerror = () => {};
    wsRef.current = ws;
    return () => ws.close();
  }, [dispatchId]);

  // Seed the ambulance marker from the last-known GPS in the API response,
  // so it shows immediately before the first live WebSocket update arrives.
  useEffect(() => {
    if (emergency?.ambulance_current_lat && emergency?.ambulance_current_lng) {
      setAmbulancePos((cur) => cur || [
        parseFloat(emergency.ambulance_current_lat),
        parseFloat(emergency.ambulance_current_lng),
      ]);
    }
  }, [emergency?.ambulance_current_lat, emergency?.ambulance_current_lng]);

  const patientPos = emergency?.patient_lat && emergency?.patient_lng
    ? [parseFloat(emergency.patient_lat), parseFloat(emergency.patient_lng)]
    : null;

  const mapCenter = patientPos || ambulancePos || [9.0, 76.8];

  const noDrivers = emergency?.no_drivers || emergency?.status === 'no_drivers';

  const hosp = emergency?.assigned_hospital;
  const hospitalPos = hosp?.lat && hosp?.lon
    ? [parseFloat(hosp.lat), parseFloat(hosp.lon)]
    : null;

  const formatEta = (secs) => {
    if (secs === null || secs === undefined) return '—';
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${String(s).padStart(2, '0')}s`;
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex justify-center items-center h-64">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <h1 className="text-2xl font-bold text-primary mb-6 flex items-center gap-2">
        <FiTruck className="text-danger" /> Emergency Tracker
      </h1>

      {/* Live status message (polls every 5s) */}
      {(() => {
        const key = emergency?.dispatch?.status || emergency?.status || 'pending';
        const msg = STATUS_MESSAGE[key] || STATUS_MESSAGE.pending;
        return (
          <div className="card mb-6 text-center" style={{ backgroundColor: '#FAF7F2' }}>
            <p className="text-xl font-bold" style={{ color: '#F97316' }}>{msg.text}</p>
            <p className="text-sm text-gray-500 mt-1">{msg.sub}</p>
          </div>
        );
      })()}

      {/* Destination hospital */}
      {emergency?.assigned_hospital?.name && (
        <div className="card mb-6">
          <p className="text-xs text-gray-500 mb-1">🏥 Going to Hospital</p>
          <p className="font-bold text-lg">{emergency.assigned_hospital.name}</p>
          {emergency.bed_reserved && (
            <p className="text-sm text-gray-500">🛏️ A bed has been reserved for you</p>
          )}
          {emergency.rerouted && (
            <p className="text-xs mt-1" style={{ color: '#F97316' }}>
              🔄 Hospital updated due to bed availability
            </p>
          )}
        </div>
      )}

      {/* Status Card */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Emergency Status</p>
          <span className={`px-3 py-1 rounded-full text-sm font-bold capitalize ${statusColor[emergency?.status] || 'bg-gray-100 text-gray-600'}`}>
            {emergency?.status?.replace('_', ' ') || '—'}
          </span>
          <p className="text-xs text-gray-500 mt-3 mb-1">Severity</p>
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
            emergency?.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
          }`}>
            {emergency?.severity || '—'}
          </span>
        </div>

        <div className="card">
          <p className="text-xs text-gray-500 mb-1">Driver</p>
          <p className="font-semibold">{emergency?.driver_name || 'Assigning…'}</p>
          {emergency?.driver_phone && (
            <a href={`tel:${emergency.driver_phone}`} className="flex items-center gap-1 text-sm text-blue-600 mt-1">
              <FiPhone className="w-3 h-3" /> {emergency.driver_phone}
            </a>
          )}
          <p className="text-xs text-gray-500 mt-3 mb-1">Vehicle</p>
          <p className="font-semibold">{emergency?.vehicle_number || '—'}</p>
        </div>

        <div className="card flex flex-col items-center justify-center">
          <FiClock className="w-8 h-8 text-accent mb-2" />
          <p className="text-xs text-gray-500">Estimated Arrival</p>
          {emergency?.status === 'completed' ? (
            <p className="text-3xl font-bold text-primary mt-1">Arrived</p>
          ) : acceptedAt ? (
            <>
              <p className="text-3xl font-bold mt-1" style={{ color: '#F97316' }}>
                {eta > 0 ? formatEta(eta) : '🚑 Arriving now!'}
              </p>
              <p className="text-xs text-gray-400 mt-1">⏱️ Timer starts from driver acceptance</p>
            </>
          ) : (
            <p className="text-lg font-semibold text-gray-400 mt-1 text-center">
              ⏳ Waiting for driver to accept…
            </p>
          )}
          {ambulancePos && (
            <span className="mt-2 text-xs text-green-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block animate-pulse" />
              Live tracking active
            </span>
          )}
        </div>
      </div>

      {/* Full Map */}
      <div className="card">
        <h2 className="text-lg font-semibold text-primary mb-4 flex items-center gap-2">
          <FiNavigation className="text-accent" /> Live Map
        </h2>
        <div className="rounded-xl overflow-hidden" style={{ height: 460, position: 'relative', zIndex: 1 }}>
          {routeInfo && (
            <div className="absolute top-4 right-4 z-10 bg-white rounded-xl shadow-lg p-3 text-sm">
              <p className="font-bold text-red-600">🚑 Ambulance Route</p>
              <p>📏 Distance: {routeInfo.distance}</p>
              <p>⏱️ ETA: {routeInfo.eta}</p>
            </div>
          )}
          <MapErrorBoundary>
            <MapContainer center={mapCenter} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="© OpenStreetMap contributors"
              />
              {patientPos && (
                <LiveMarker position={patientPos} icon={patientIcon} label="Your Location" />
              )}
              {ambulancePos && (
                <LiveMarker position={ambulancePos} icon={ambulanceIcon} label="Ambulance" />
              )}
              {hospitalPos && (
                <Marker position={hospitalPos} icon={hospitalIcon}>
                  <Popup>
                    🏥 {hosp?.name || 'Destination Hospital'}
                    <br />
                    <span style={{ color: '#F97316' }}>🛏️ Bed reserved for you</span>
                  </Popup>
                </Marker>
              )}
              {patientPos && ambulancePos && (
                <RouteLine from={ambulancePos} to={patientPos} onRouteInfo={setRouteInfo} />
              )}
            </MapContainer>
          </MapErrorBoundary>
        </div>
        <div className="flex gap-6 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" /> Your location
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
            Ambulance {ambulancePos ? '(live)' : '(waiting for GPS…)'}
          </span>
        </div>
      </div>

      {/* No ambulance available — call emergency services */}
      {noDrivers && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 text-center shadow-2xl">
            <div className="text-6xl mb-4">🚨</div>
            <h3 className="font-bold text-xl text-black mb-2">No Ambulance Available!</h3>
            <p className="text-gray-500 text-sm mb-6">
              All nearby drivers are currently unavailable. Please call emergency services immediately!
            </p>
            <a
              href="tel:108"
              className="block w-full py-4 rounded-full font-bold text-white text-xl mb-3 bg-red-600 hover:bg-red-700"
            >
              📞 Call 108
            </a>
            <a
              href="tel:112"
              className="block w-full py-3 rounded-full font-semibold text-white bg-black mb-4"
            >
              📞 Call 112 (National Emergency)
            </a>
            <button
              onClick={() => navigate('/patient/emergency')}
              className="text-sm underline"
              style={{ color: '#F97316' }}
            >
              Try Again
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
};

export default EmergencyTracker;
