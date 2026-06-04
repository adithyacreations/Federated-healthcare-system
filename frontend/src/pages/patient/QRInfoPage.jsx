import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = 'http://localhost:8000';

const RISK_STYLES = {
  low: 'bg-success/15 text-success',
  moderate: 'bg-warning/15 text-warning',
  high: 'bg-danger/15 text-danger',
  unknown: 'bg-gray-200 text-gray-600',
};

const QRInfoPage = () => {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/patient/qr-info/${token}/`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && body.success) {
          setState({ loading: false, data: body.data });
        } else if (body.expired) {
          setState({ loading: false, expired: true });
        } else {
          setState({ loading: false, invalid: true });
        }
      })
      .catch(() => {
        if (active) setState({ loading: false, invalid: true });
      });
    return () => {
      active = false;
    };
  }, [token]);

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-light flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );

  if (state.loading) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center text-gray-500">
          Loading patient information…
        </div>
      </Shell>
    );
  }

  if (state.expired) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-danger p-6 text-center">
            <h1 className="text-white text-xl font-bold">QR Code Expired!</h1>
          </div>
          <div className="p-6 text-center text-gray-600">
            This QR code has expired. The patient needs to generate a new QR code
            from their FederCare account.
          </div>
        </div>
      </Shell>
    );
  }

  if (state.invalid) {
    return (
      <Shell>
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-danger p-6 text-center">
            <h1 className="text-white text-xl font-bold">Invalid QR Code</h1>
          </div>
          <div className="p-6 text-center text-gray-600">
            This QR code is not valid. Please scan a valid FederCare patient QR code.
          </div>
        </div>
      </Shell>
    );
  }

  const d = state.data;
  const riskClass = RISK_STYLES[d.risk_level] || RISK_STYLES.unknown;

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-primary p-6">
          <p className="text-accent text-xs tracking-widest uppercase mb-1">
            FederCare — Emergency EHR
          </p>
          <h1 className="text-white text-2xl font-bold">{d.patient_name}</h1>
          <p className="text-white/70 text-sm mt-1">
            {d.age != null ? `${d.age} yrs` : ''} {d.gender ? `· ${d.gender}` : ''}
          </p>
        </div>

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-light rounded-xl p-3">
              <p className="text-xs text-gray-500">Blood Group</p>
              <p className="text-lg font-bold text-primary">
                {d.blood_group || '—'}
              </p>
            </div>
            <div className="bg-light rounded-xl p-3">
              <p className="text-xs text-gray-500">Emergency Contact</p>
              <p className="text-lg font-bold text-primary">
                {d.emergency_contact || '—'}
              </p>
            </div>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-1">Health Risk Level</p>
            <span
              className={`inline-block px-3 py-1 rounded-full text-sm font-semibold capitalize ${riskClass}`}
            >
              {d.risk_level}
            </span>
            <span className="ml-3 text-xs text-gray-500">
              Diabetes {d.diabetes_risk}% · Heart {d.heart_risk}%
            </span>
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Known Allergies</p>
            {d.allergies && d.allergies.length ? (
              <div className="flex flex-wrap gap-2">
                {d.allergies.map((a, i) => (
                  <span
                    key={i}
                    className="bg-danger/10 text-danger text-xs px-2 py-1 rounded-md"
                  >
                    {a}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No recorded allergies</p>
            )}
          </div>

          <div>
            <p className="text-xs text-gray-500 mb-2">Recent Prescriptions</p>
            {d.recent_prescriptions && d.recent_prescriptions.length ? (
              <ul className="space-y-1">
                {d.recent_prescriptions.map((p, i) => (
                  <li
                    key={i}
                    className="flex justify-between text-sm border-b border-gray-100 pb-1"
                  >
                    <span className="text-gray-700">{p.title}</span>
                    <span className="text-gray-400">{p.date}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400">No recent prescriptions</p>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center pt-2 border-t border-gray-100">
            QR valid until {d.expires_at}
          </p>
        </div>
      </div>
    </Shell>
  );
};

export default QRInfoPage;
