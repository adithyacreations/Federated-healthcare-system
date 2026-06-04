import { useState } from 'react';
import toast from 'react-hot-toast';

/* GPS location picker: auto-detect via browser geolocation OR manual lat/lon
 * entry, with a live OpenStreetMap preview. Controlled — parent owns the
 * latitude/longitude strings and receives updates via onChange(lat, lon). */
const LocationPicker = ({ latitude, longitude, onChange }) => {
  const [detecting, setDetecting] = useState(false);
  const detected = Boolean(latitude && longitude);

  const detect = () => {
    if (!navigator.geolocation) {
      toast.error('GPS not supported in this browser!');
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange(position.coords.latitude.toFixed(6), position.coords.longitude.toFixed(6));
        setDetecting(false);
        toast.success('📍 Location detected successfully!');
      },
      (error) => {
        setDetecting(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission denied! Please enter manually.'
            : 'Location detection failed! Please enter manually.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  };

  const lat = parseFloat(latitude);
  const lon = parseFloat(longitude);
  const showMap = !Number.isNaN(lat) && !Number.isNaN(lon);

  return (
    <div>
      <button
        type="button"
        onClick={detect}
        disabled={detecting}
        className="w-full py-3 rounded-xl font-semibold text-white mb-4 flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ backgroundColor: '#000000' }}
      >
        {detecting ? (
          <><span className="animate-spin">⏳</span> Detecting Location…</>
        ) : detected ? (
          <>✅ Location Set — Detect Again</>
        ) : (
          <>📍 Auto Detect GPS Location</>
        )}
      </button>

      <div className="flex items-center gap-3 mb-4">
        <hr className="flex-1 border-gray-200" />
        <span className="text-gray-400 text-sm">OR enter manually</span>
        <hr className="flex-1 border-gray-200" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-black mb-1 block">Latitude</label>
          <input
            type="number"
            step="any"
            value={latitude}
            onChange={(e) => onChange(e.target.value, longitude)}
            placeholder="e.g. 8.8932"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-black mb-1 block">Longitude</label>
          <input
            type="number"
            step="any"
            value={longitude}
            onChange={(e) => onChange(latitude, e.target.value)}
            placeholder="e.g. 76.6141"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-400"
          />
        </div>
      </div>

      {showMap && (
        <div className="mt-3 rounded-xl overflow-hidden border border-gray-200" style={{ height: 150 }}>
          <iframe
            title="Hospital Location"
            width="100%"
            height="150"
            frameBorder="0"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${lon - 0.01}%2C${lat - 0.01}%2C${lon + 0.01}%2C${lat + 0.01}&layer=mapnik&marker=${lat}%2C${lon}`}
          />
        </div>
      )}

      <p className="text-xs text-gray-400 mt-2">
        💡 Kerala coordinates range: Lat 8.0–12.8 | Lon 74.8–77.4
      </p>
    </div>
  );
};

export default LocationPicker;
