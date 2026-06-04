import { useState } from 'react';
import toast from 'react-hot-toast';

import DashboardLayout from '../../components/common/DashboardLayout';
import LiveIndicator from '../../components/common/LiveIndicator';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';

const severityClass = (s) => {
  switch (s) {
    case 'critical': return 'bg-red-100 text-red-700';
    case 'high': return 'bg-orange-100 text-orange-700';
    case 'moderate': return 'bg-yellow-100 text-yellow-700';
    default: return 'bg-green-100 text-green-700';
  }
};

const fmtTime = (iso) => {
  if (!iso) return 'Just arrived';
  try {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Just arrived';
  }
};

const IncomingPatientCard = ({ patient, acknowledging, onAcknowledge, markingReady, onMarkReady }) => (
  <div className="bg-white rounded-2xl border-2 p-4 shadow-sm" style={{ borderColor: '#FCA5A5' }}>
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-3">
          <span
            className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shrink-0"
            style={{ backgroundColor: '#EF4444' }}
          >
            {patient.patient_name?.charAt(0)?.toUpperCase() || 'P'}
          </span>
          <div className="min-w-0">
            <p className="font-bold text-black text-lg truncate">{patient.patient_name}</p>
            <p className="text-sm text-gray-500">📞 {patient.patient_phone || 'No phone'}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className={`text-xs px-3 py-1 rounded-full font-bold uppercase ${severityClass(patient.severity)}`}>
            🚨 {patient.severity?.toUpperCase()}
          </span>
          {patient.blood_group && (
            <span className="text-xs px-3 py-1 rounded-full bg-red-50 text-red-600 font-medium">
              🩸 {patient.blood_group}
            </span>
          )}
          <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600">
            🚑 {patient.vehicle_no || patient.ambulance_no}
          </span>
          <span className="text-xs px-3 py-1 rounded-full bg-gray-100 text-gray-600">
            👤 {patient.driver_name}
          </span>
          {patient.bed_ward && (
            <span className="text-xs px-3 py-1 rounded-full bg-green-50 text-green-600 font-medium">
              🛏️ {patient.bed_ward}{patient.bed_type ? ` · ${patient.bed_type}` : ''}
            </span>
          )}
          <span className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-600">
            🕐 {fmtTime(patient.arrived_at)}
          </span>
        </div>

        {patient.bed_severity_label && (
          <div
            className={`rounded-xl p-3 mt-3 flex items-center gap-3 ${
              patient.severity === 'critical'
                ? 'bg-red-50 border border-red-200'
                : patient.severity === 'high'
                ? 'bg-orange-50 border border-orange-200'
                : 'bg-green-50 border border-green-200'
            }`}
          >
            <span className="text-2xl">🛏️</span>
            <div>
              <p
                className={`font-bold text-sm ${
                  patient.severity === 'critical'
                    ? 'text-red-700'
                    : patient.severity === 'high'
                    ? 'text-orange-700'
                    : 'text-green-700'
                }`}
              >
                {patient.bed_severity_label}
              </p>
              <p className="text-xs text-gray-500">
                Ward: {patient.bed_ward || 'N/A'} · Type: {patient.bed_type || 'N/A'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-2 w-44">
        {patient.bed_ready ? (
          <div className="py-2 rounded-full text-sm font-semibold text-center bg-green-100 text-green-700">
            ✅ Hospital Ready!
            {patient.bed_ready_at && (
              <span className="text-xs block text-green-600">
                {new Date(patient.bed_ready_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        ) : (
          <button
            onClick={() => onMarkReady(patient.dispatch_id)}
            disabled={markingReady === patient.dispatch_id}
            className="py-2 rounded-full text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: '#000000' }}
          >
            {markingReady === patient.dispatch_id ? '⏳ Notifying…' : '🏥 Mark Bed Ready'}
          </button>
        )}

        {patient.status === 'pending_acknowledgment' ? (
          <button
            onClick={() => onAcknowledge(patient.dispatch_id)}
            disabled={acknowledging === patient.dispatch_id}
            className="py-2 rounded-full font-semibold text-white text-sm disabled:opacity-50 transition-all"
            style={{ backgroundColor: '#F97316' }}
          >
            {acknowledging === patient.dispatch_id ? 'Processing…' : 'Patient Arrived'}
          </button>
        ) : (
          <span className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-blue-50 text-blue-600">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            En route
          </span>
        )}
      </div>
    </div>
  </div>
);

const HospitalEmergencyPage = () => {
  const { data, loading, refetch, refreshing, lastUpdated } = useApi(
    '/api/emergency/incoming-patients/', { pollInterval: 15000 },
  );
  const incomingPatients = Array.isArray(data) ? data : [];
  const [acknowledging, setAcknowledging] = useState(null);
  const [markingReady, setMarkingReady] = useState(null);

  const handleAcknowledge = async (dispatchId) => {
    setAcknowledging(dispatchId);
    try {
      const res = await API.post(`/api/emergency/dispatch/${dispatchId}/acknowledge/`);
      if (res.data?.success) {
        toast.success('✅ Patient acknowledged! Ambulance freed.');
        refetch();
      }
    } catch {
      toast.error('Failed to acknowledge!');
    } finally {
      setAcknowledging(null);
    }
  };

  const handleMarkReady = async (dispatchId) => {
    setMarkingReady(dispatchId);
    try {
      const res = await API.post(`/api/emergency/dispatch/${dispatchId}/bed-ready/`);
      if (res.data?.success) {
        toast.success('🏥 Hospital marked ready! Driver notified.');
        // Refetch so the persisted bed_ready state is reflected immediately.
        refetch();
      }
    } catch {
      toast.error('Failed to mark ready!');
    } finally {
      setMarkingReady(null);
    }
  };

  return (
    <DashboardLayout>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 className="text-2xl font-bold text-black">🚨 Emergency Patients</h1>
          <p className="text-gray-500 text-sm">Incoming ambulance patients requiring acknowledgment</p>
        </div>
        <LiveIndicator refreshing={refreshing} lastUpdated={lastUpdated} onRefresh={refetch} />
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 text-gray-400">
          Loading incoming patients…
        </div>
      ) : incomingPatients.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
          <span className="text-6xl mb-4 block">🏥</span>
          <p className="font-semibold text-lg text-gray-700">No Incoming Patients</p>
          <p className="text-gray-400 text-sm mt-2">
            All ambulances are available. Incoming patients will appear here.
          </p>
        </div>
      ) : (
        <>
          <div
            className="flex items-center gap-3 p-4 rounded-2xl mb-4 border-2"
            style={{ backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' }}
          >
            <span className="text-3xl animate-bounce">🚨</span>
            <div className="flex-1">
              <p className="font-bold text-red-700 text-lg">
                {incomingPatients.length} Ambulance(s) Arriving!
              </p>
              <p className="text-red-600 text-sm">
                Please acknowledge incoming patients to free ambulances for the next emergency.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            {incomingPatients.map((patient) => (
              <IncomingPatientCard
                key={patient.dispatch_id}
                patient={patient}
                acknowledging={acknowledging}
                onAcknowledge={handleAcknowledge}
                markingReady={markingReady}
                onMarkReady={handleMarkReady}
              />
            ))}
          </div>
        </>
      )}
    </DashboardLayout>
  );
};

export default HospitalEmergencyPage;
