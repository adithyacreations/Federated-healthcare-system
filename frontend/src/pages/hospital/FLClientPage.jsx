import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  FiCpu, FiDatabase, FiAlertTriangle, FiLoader, FiActivity, FiRefreshCw,
} from 'react-icons/fi';
import DashboardLayout from '../../components/common/DashboardLayout';
import Badge from '../../components/common/Badge';
import API from '../../api/axios';
import useApi from '../../hooks/useApi';

// ─── Helpers ───────────────────────────────────────────────────────────────────

const DataSourceBadge = ({ src = '' }) => {
  if (!src) return <span className="text-gray-400">—</span>;
  if (src.includes('real(') && src.includes('reference(')) {
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Hybrid · {src}</span>;
  }
  if (src.startsWith('real(')) {
    return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Real Only · {src}</span>;
  }
  return <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-700">Reference Only</span>;
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

// ─── Component ─────────────────────────────────────────────────────────────────

const FLClientPage = () => {
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState(null);
  const [flAlert, setFlAlert] = useState(null);

  const patientStats = useApi('/api/hospital/patients/stats/');
  const flStatus     = useApi('/api/federated/hospital-status/');
  const roundsApi    = useApi('/api/federated/rounds/');
  const history      = useApi('/api/federated/my-submissions/');

  // Keep latest refetch handlers in a ref so the WS effect can stay stable
  const refetchersRef = useRef({});
  refetchersRef.current = {
    flStatus: flStatus.refetch,
    roundsApi: roundsApi.refetch,
    patientStats: patientStats.refetch,
    history: history.refetch,
  };

  // ─── Real-time FL updates via WebSocket ─────────────────────────────────
  useEffect(() => {
    const wsHost = window.location.hostname || 'localhost';
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${wsProto}://${wsHost}:8000/ws/fl/global/`);

    ws.onopen = () => console.log('[FL] WebSocket connected');

    ws.onmessage = (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      const { type, data = {} } = payload;
      const r = refetchersRef.current;

      if (type === 'round_started') {
        setFlAlert({ type: 'success', message: `🎉 ${data.message || 'A new FL round has started!'}` });
        r.roundsApi?.();
        r.flStatus?.();
      }
      if (type === 'model_updated') {
        setFlAlert({ type: 'info', message: `✅ ${data.message || 'Global model updated!'}` });
        r.roundsApi?.();
        r.flStatus?.();
        r.history?.();
      }
      if (type === 'weight_submitted') {
        // Refresh progress bar silently when another hospital submits
        r.roundsApi?.();
      }
    };

    ws.onerror = (e) => console.warn('[FL] WebSocket error', e);

    return () => { try { ws.close(); } catch { /* noop */ } };
  }, []);

  // Derive active round (training or aggregating)
  const roundsList  = roundsApi.data?.rounds || [];
  const activeRound = roundsList.find((r) => ['training', 'aggregating'].includes(r.status)) || null;

  const latestRoundStatus = flStatus.data?.latest_round_status;
  const isAggregating     = latestRoundStatus === 'aggregating';

  // Trust the backend's per-round_id submission flag. round_number repeats
  // after Reset/Cancel, so matching history by round_number gives false
  // positives — match by round_id only.
  const alreadySubmittedThisRound = useMemo(() => {
    if (flStatus.data?.has_submitted === true) return true;
    if (flStatus.data?.submitted_this_round === true) return true;
    if (!activeRound || !Array.isArray(history.data)) return false;
    return history.data.some((s) => s.round_id === activeRound.round_id);
  }, [flStatus.data, activeRound, history.data]);

  const alreadySubmitted = alreadySubmittedThisRound;
  const canSubmit = activeRound
    && ['training', 'aggregating'].includes(activeRound.status)
    && !alreadySubmittedThisRound;

  const submitWeights = async () => {
    setSubmitting(true);
    setSubmitResult(null);
    try {
      const res = await API.post('/api/federated/submit-weights/', {});
      const d = res.data?.data || {};
      setSubmitResult(d);
      toast.success(`Weights submitted! Accuracy: ${d.local_accuracy != null ? d.local_accuracy.toFixed(1) + '%' : 'N/A'}`);
      flStatus.refetch();
      patientStats.refetch();
      history.refetch();
      roundsApi.refetch();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshAll = () => {
    flStatus.refetch();
    roundsApi.refetch();
    patientStats.refetch();
    history.refetch();
  };

  // Training data derived values
  const ps          = patientStats.data;
  const total       = ps?.total_patients ?? 0;
  const ready       = ps?.ready_for_training ?? false;
  const refCount    = total < 50 ? 100 : 0;
  const totalSamples = total + refCount;
  const modeLabel   = total >= 50
    ? `Real Only (${total} patients)`
    : total >= 10
      ? `Hybrid (${total} real + ${refCount} reference)`
      : 'Reference Only';

  return (
    <DashboardLayout>

      {/* ─── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary-500">Federated Learning Client</h1>
          <p className="text-sm text-gray-500 mt-0.5">Train locally — share only encrypted weights</p>
        </div>
        <button
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-primary-500 transition"
        >
          <FiRefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ─── Real-time FL Alert ────────────────────────────────── */}
      {flAlert && (
        <div className={`p-4 rounded-xl mb-4 flex items-start gap-3 ${
          flAlert.type === 'success'
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-blue-50 border border-blue-200 text-blue-800'
        }`}>
          <div className="flex-1">
            <p className="font-medium text-sm">{flAlert.message}</p>
            <button
              onClick={() => setFlAlert(null)}
              className="text-xs mt-1 underline opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ─── 1. Training Data Stats ────────────────────────────── */}
      <section className="mb-6">
        <h2 className="text-base font-semibold text-gray-700 mb-3">Training Data</h2>
        {patientStats.loading ? (
          <div className="card text-center text-gray-400 text-sm py-6">Loading patient stats…</div>
        ) : !ready ? (
          <div className="flex items-start gap-3 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3">
            <FiAlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-warning">
                Add more hospital patients for better local model accuracy.
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {total} patient record{total !== 1 ? 's' : ''} — need ≥10 for real data training. Using reference dataset only.
              </p>
            </div>
            <Link to="/hospital/patients" className="text-xs font-semibold text-primary-500 hover:underline whitespace-nowrap">
              Add Patients →
            </Link>
          </div>
        ) : (
          <div className="flex items-start gap-3 bg-success/10 border border-success/30 rounded-xl px-4 py-3">
            <FiDatabase className="w-5 h-5 text-success mt-0.5 shrink-0" />
            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1 text-xs">
              <div>
                <div className="text-gray-500 uppercase font-semibold mb-0.5">Hospital Patients</div>
                <div className="font-bold text-gray-800">{total}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase font-semibold mb-0.5">Training Samples</div>
                <div className="font-bold text-gray-800">{totalSamples}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase font-semibold mb-0.5">Training Mode</div>
                <div className="font-bold text-gray-800">{modeLabel}</div>
              </div>
              <div>
                <div className="text-gray-500 uppercase font-semibold mb-0.5">Ready</div>
                <div className="font-bold text-success">✅ Yes</div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ─── 2. FL Round Status + Submit ───────────────────────── */}
      <section className="mb-6">
        <h2 className="text-base font-semibold text-gray-700 mb-3">FL Round Status</h2>
        <div className="card">
          {flStatus.loading ? (
            <p className="text-gray-500 text-sm py-4 text-center">Loading FL status…</p>
          ) : !flStatus.data?.current_global_model_version ? (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">🤖</div>
              <p className="text-gray-500 text-sm font-medium">No active global model.</p>
              <p className="text-gray-400 text-xs mt-1">Wait for Super Admin to initialize the FL model.</p>
            </div>
          ) : (
            <div className="space-y-4">

              {/* Info row: model · round · submit */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

                {/* Global model */}
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-1">Global Model</div>
                  <div className="text-xl font-bold text-primary-500">
                    v{flStatus.data.current_global_model_version}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Accuracy: {flStatus.data.global_accuracy ?? 0}%
                  </div>
                </div>

                {/* Active round + progress */}
                <div>
                  <div className="text-xs uppercase text-gray-500 mb-1">Active Round</div>
                  {activeRound ? (
                    <>
                      <div className="text-xl font-bold text-primary-500">Round {activeRound.round_number}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                          <div
                            className="bg-primary-500 h-1.5 rounded-full transition-all"
                            style={{
                              width: activeRound.hospitals_invited > 0
                                ? `${Math.round((activeRound.hospitals_completed / activeRound.hospitals_invited) * 100)}%`
                                : '0%',
                            }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 font-medium whitespace-nowrap">
                          {activeRound.hospitals_completed}/{activeRound.hospitals_invited} hospitals
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-xl font-bold text-gray-400">
                        Round {flStatus.data.latest_round_number ?? '—'}
                      </div>
                      <div className="mt-1">
                        <Badge
                          status={flStatus.data.latest_round_status || 'info'}
                          text={flStatus.data.latest_round_status || '—'}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Submit area */}
                <div className="flex flex-col items-start lg:items-end gap-2">
                  {alreadySubmittedThisRound ? (
                    <button
                      disabled
                      className="px-6 py-3 rounded-xl font-medium bg-green-100 text-green-600 cursor-not-allowed"
                    >
                      Already Submitted
                    </button>
                  ) : (
                    <>
                      {isAggregating && (
                        <div className="text-xs bg-blue-50 border border-blue-200 text-blue-700 px-3 py-2 rounded-lg text-right max-w-[240px]">
                          ℹ️ Threshold reached! You can still submit before Super Admin runs FedAvg.
                        </div>
                      )}
                      {!canSubmit && !isAggregating && (
                        <p className="text-xs text-gray-400 text-right">
                          {activeRound
                            ? 'Round in progress…'
                            : 'Waiting for Super Admin to start a training round.'}
                        </p>
                      )}
                      <button
                        onClick={submitWeights}
                        disabled={!canSubmit || submitting}
                        className="inline-flex items-center gap-2 bg-success text-white px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-90 transition disabled:opacity-40"
                      >
                        {submitting
                          ? <><FiLoader className="w-4 h-4 animate-spin" /> Training…</>
                          : <><FiCpu className="w-4 h-4" /> Submit Local Weights</>
                        }
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Already-submitted card */}
              {alreadySubmittedThisRound && !submitResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">✅</span>
                    <div>
                      <p className="font-semibold text-green-800">Weights Already Submitted!</p>
                      <p className="text-sm text-green-600">
                        Your local weights have been submitted for Round{' '}
                        {activeRound?.round_number ?? flStatus.data?.latest_round_number}.
                        Super Admin may have used "Simulate All Hospitals", or you already
                        submitted manually.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Submit result card */}
              {submitResult && (
                <div className="border border-success/40 bg-success/5 rounded-xl p-4">
                  <p className="text-sm font-bold text-success mb-2">✅ Weights Submitted Successfully!</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="text-gray-500 uppercase font-semibold mb-0.5">Local Accuracy</div>
                      <div className="font-bold text-gray-800 text-base">
                        {submitResult.local_accuracy != null
                          ? `${submitResult.local_accuracy.toFixed(1)}%`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 uppercase font-semibold mb-0.5">Training Samples</div>
                      <div className="font-bold text-gray-800 text-base">
                        {(submitResult.training_samples || 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 uppercase font-semibold mb-0.5">Real Patients</div>
                      <div className="font-bold text-gray-800 text-base">{submitResult.patient_count ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 uppercase font-semibold mb-0.5">Data Source</div>
                      <DataSourceBadge src={submitResult.data_source} />
                    </div>
                  </div>
                  {submitResult.threshold_reached && (
                    <p className="text-xs text-primary-500 font-semibold mt-2">
                      🎯 Threshold reached — Super Admin can now run FedAvg!
                    </p>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </section>

      {/* ─── 3. My Submission History ──────────────────────────── */}
      <section>
        <h2 className="text-base font-semibold text-gray-700 mb-3">My Submission History</h2>
        {history.loading ? (
          <div className="card text-center text-gray-400 text-sm py-6">Loading submissions…</div>
        ) : !Array.isArray(history.data) || history.data.length === 0 ? (
          <div className="card text-center py-10">
            <FiActivity className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No submissions yet.</p>
            <p className="text-gray-400 text-xs mt-1">Submit your local weights above to start contributing.</p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                    <th className="px-4 py-3">Round</th>
                    <th className="px-4 py-3">Accuracy</th>
                    <th className="px-4 py-3">Samples</th>
                    <th className="px-4 py-3">Privacy</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {history.data.map((s) => (
                    <tr key={s.weight_id} className="hover:bg-primary-50/20 transition">
                      <td className="px-4 py-3 font-semibold text-primary-500">
                        Round {s.round_number}
                        {s.round_id && (
                          <span className="ml-1 text-[10px] font-normal text-gray-400">
                            #{String(s.round_id).slice(0, 6)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-green-600">
                        {Number(s.local_accuracy).toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {(s.training_samples || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {s.noise_added
                          ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">🔒 Noise Added</span>
                          : <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(s.submitted_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${
                          s.round_status === 'completed'   ? 'bg-green-100 text-green-700'   :
                          s.round_status === 'training'    ? 'bg-blue-100 text-blue-700'     :
                          s.round_status === 'aggregating' ? 'bg-purple-100 text-purple-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {s.round_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

    </DashboardLayout>
  );
};

export default FLClientPage;
