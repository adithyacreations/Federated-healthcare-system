import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { FiMapPin } from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import API from '../../api/axios';

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical', color: '#EF4444', description: 'Life threatening' },
  { value: 'high', label: 'High', color: '#F97316', description: 'Urgent attention' },
  { value: 'moderate', label: 'Moderate', color: '#EAB308', description: 'Needs help soon' },
  { value: 'low', label: 'Low', color: '#22C55E', description: 'Non-urgent' },
];

const getLocation = () =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS not supported'));
      return;
    }
    const timeout = setTimeout(() => reject(new Error('Location timeout')), 10000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeout);
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });

const EmergencyPage = () => {
  const navigate = useNavigate();

  const [selectedSeverity, setSelectedSeverity] = useState('high');
  const [sosLoading, setSosLoading] = useState(false);
  const [sosTriggered, setSosTriggered] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualAddress, setManualAddress] = useState('');
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

  const gpsSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const submitEmergency = async (location) => {
    setSosLoading(true);
    try {
      const { data } = await API.post('/api/patient/emergency/', {
        patient_lat: Number(location.lat).toFixed(6),
        patient_lng: Number(location.lng).toFixed(6),
        severity: selectedSeverity,
        address: location.address || '',
      });
      const id = data?.data?.emergency_id;
      if (id) {
        setSosTriggered(true);
        toast.success('Emergency alert sent — dispatching ambulance');
        navigate(`/patient/emergency-tracker/${id}`);
      } else {
        toast.error('Emergency could not be created');
      }
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Emergency dispatch failed');
    } finally {
      setSosLoading(false);
    }
  };

  const handleSOS = async () => {
    setDetecting(true);
    setShowManual(false);
    try {
      const location = await getLocation();
      setDetecting(false);
      submitEmergency(location);
    } catch {
      setDetecting(false);
      setShowManual(true);
      toast('GPS unavailable — please enter your location manually', { icon: '📍' });
    }
  };

  const busy = sosLoading || detecting;

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        {/* Impact section */}
        <motion.section
          variants={cardVariants}
          className="rounded-2xl border border-hairline bg-white p-6 sm:p-10 mb-8 text-center"
        >
          <h1 className="font-bricolage text-4xl font-extrabold text-ink">Emergency SOS</h1>
          <p className="text-muted mt-2">Select severity, then press the button to dispatch help.</p>

          {/* Severity selector — plain CSS only (no framer-motion) to avoid lag */}
          <div className="grid grid-cols-2 gap-3 mt-6 max-w-md mx-auto">
            {SEVERITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedSeverity(option.value)}
                style={{
                  backgroundColor: selectedSeverity === option.value ? option.color : '#FFFFFF',
                  borderColor: option.color,
                  color: selectedSeverity === option.value ? '#FFFFFF' : option.color,
                  border: `2px solid ${option.color}`,
                  borderRadius: '9999px',
                  padding: '12px 16px',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  outline: 'none',
                }}
              >
                {option.label}
                <span style={{ display: 'block', fontSize: '11px', fontWeight: '400', opacity: 0.8 }}>
                  {option.description}
                </span>
              </button>
            ))}
          </div>

          {/* GPS status */}
          <div className="mt-5 inline-flex items-center gap-2 text-sm">
            <span className={`w-2.5 h-2.5 rounded-full ${detecting ? 'bg-orange-500 animate-pulse' : gpsSupported ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-muted">
              {detecting ? 'Detecting location…' : gpsSupported ? 'GPS Ready' : 'GPS unavailable'}
            </span>
          </div>

          {/* SOS button — plain button, no complex click animations */}
          <div className="flex items-center justify-center my-10" style={{ height: 220 }}>
            <button
              type="button"
              onClick={handleSOS}
              disabled={busy || sosTriggered}
              style={{
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                backgroundColor: sosTriggered ? '#22C55E' : '#EF4444',
                color: 'white',
                fontSize: '24px',
                fontWeight: '800',
                border: 'none',
                cursor: busy ? 'wait' : 'pointer',
                boxShadow: sosTriggered
                  ? '0 0 0 0 rgba(34,197,94,0)'
                  : '0 0 0 20px rgba(239,68,68,0.2)',
                transition: 'all 0.3s ease',
                outline: 'none',
              }}
            >
              {busy ? '...' : sosTriggered ? '✓ SENT' : 'SOS'}
            </button>
          </div>

          <p className="text-sm text-muted">Tap to send an emergency alert to the nearest ambulance.</p>

          {/* Manual location fallback */}
          {showManual && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mt-6 text-left max-w-lg mx-auto">
              <p className="text-red-700 font-semibold mb-3 flex items-center gap-1">
                <FiMapPin /> Please enter your location manually
              </p>
              <input
                placeholder="Enter your address or landmark"
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                className="w-full bg-white border border-hairline rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none focus:border-orange-400"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  placeholder="Latitude (optional)"
                  value={manualLat}
                  onChange={(e) => setManualLat(e.target.value)}
                  type="number"
                  className="bg-white border border-hairline rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                />
                <input
                  placeholder="Longitude (optional)"
                  value={manualLng}
                  onChange={(e) => setManualLng(e.target.value)}
                  type="number"
                  className="bg-white border border-hairline rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                />
              </div>
              <button
                onClick={() => submitEmergency({
                  lat: parseFloat(manualLat) || 8.5241,
                  lng: parseFloat(manualLng) || 76.9366,
                  address: manualAddress,
                })}
                disabled={sosLoading}
                className="bg-red-500 text-white px-6 py-3 rounded-full w-full mt-3 font-bold hover:bg-red-600 disabled:opacity-60"
              >
                🚨 Send Emergency Alert
              </button>
              <p className="text-xs text-red-600 mt-2">
                If you leave latitude/longitude blank, a default city location is used so help can still be dispatched.
              </p>
            </div>
          )}
        </motion.section>
      </motion.div>
    </DashboardLayout>
  );
};

export default EmergencyPage;
