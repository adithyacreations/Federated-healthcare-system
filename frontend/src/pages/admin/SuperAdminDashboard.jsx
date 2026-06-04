import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import {
  FiActivity, FiUsers, FiCheckSquare, FiCpu, FiAlertTriangle,
  FiArrowRight, FiFileText,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import '../vendor/vendor-design.css';

// Deterministic 8-point sparkline series from a seed number.
const sparkPoints = (seed) => {
  const out = [];
  let v = (Math.abs(Number(seed) || 0) % 9) + 4;
  for (let i = 0; i < 8; i += 1) {
    v += ((seed * (i + 3)) % 7) - 3;
    out.push(Math.max(2, Math.min(20, v)));
  }
  return out;
};

const Sparkline = ({ seed, color }) => {
  const data = sparkPoints(seed);
  const max = Math.max(...data); const min = Math.min(...data);
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * 60;
      const y = 22 - ((v - min) / (max - min || 1)) * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width="64" height="24" className="v-stat-spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

const StatCard = ({ label, value, icon: Icon, sparkColor, highlight }) => (
  <div className="v-stat" style={highlight ? { background: '#FFF7ED', borderColor: '#FED7AA' } : undefined}>
    <div className="v-stat-label">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon style={{ width: 13, height: 13, color: highlight ? '#F97316' : 'var(--v-orange)' }} />
        {label}
      </span>
    </div>
    <div className="v-stat-value" style={highlight ? { color: '#F97316' } : undefined}>{value}</div>
    <Sparkline seed={Number(String(value).replace(/\D/g, '')) || 7} color={sparkColor} />
  </div>
);

const fmtTime = (iso) => {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return ''; }
};

const ALERT_CHIP = {
  low: { bg: '#DBEAFE', color: '#1E40AF', label: 'Low' },
  moderate: { bg: '#FEF3C7', color: '#92400E', label: 'Moderate' },
  high: { bg: '#FFE4D2', color: '#C2410C', label: 'High' },
  critical: { bg: '#FEE2E2', color: '#991B1B', label: 'Critical' },
};

const SuperAdminDashboard = () => {
  const stats = useApi('/api/auth/admin-dashboard/');
  const fl = useApi('/api/federated/rounds/');
  const epidemic = useApi('/api/federated/epidemic/');

  const accuracyTrend = useMemo(
    () => (fl.data?.accuracy_trend || []).map((r) => ({ round: `R${r.round}`, accuracy: r.accuracy })),
    [fl.data],
  );

  const totalHospitals = stats.data?.total_hospitals ?? 0;
  const totalDoctors = stats.data?.total_doctors ?? 0;
  const totalPatients = stats.data?.total_patients ?? 0;
  const activeUsers = totalDoctors + totalPatients;
  const pendingCount = stats.data?.pending_approvals ?? 0;
  const flRoundsCompleted = accuracyTrend.length;

  const spikes = (epidemic.data?.trends || []).filter((t) => t.spike_detected);
  const recent = stats.data?.recent_activity || stats.data?.recent_logs || [];

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible" className="v-scope v-page">
        {/* Page head */}
        <div className="v-page-head">
          <div>
            <h1 className="v-page-title">
              Hi, Admin <span className="accent">·</span> today
            </h1>
            <p className="v-page-sub">Here&apos;s what&apos;s happening across the FederCare network.</p>
          </div>
          <div className="v-page-actions">
            <Link to="/admin/audit-logs" className="v-btn-ghost">
              <FiFileText style={{ width: 14, height: 14 }} /> Audit logs
            </Link>
            <Link to="/admin/approvals" className="v-btn-primary">
              <FiCheckSquare style={{ width: 14, height: 14 }} /> Review approvals
            </Link>
          </div>
        </div>

        {/* Epidemic alert banner — preserved from previous design */}
        {spikes.length > 0 && (
          <motion.div
            variants={cardVariants}
            className="v-card"
            style={{ background: '#FFF7ED', borderColor: '#FED7AA', padding: '14px 18px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <FiAlertTriangle style={{ width: 22, height: 22, color: '#F97316', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontWeight: 700, color: 'var(--v-ink)' }}>
                {spikes.length} active epidemic spike{spikes.length > 1 ? 's' : ''} detected
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--v-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {spikes.map((s) => `${s.disease_name} (${s.region || '—'})`).join(' · ')}
              </p>
            </div>
            <Link to="/admin/epidemic" className="v-btn-primary" style={{ padding: '8px 14px', fontSize: 12 }}>Review</Link>
          </motion.div>
        )}

        {/* Stats */}
        <div className="v-stats">
          <StatCard label="Total Hospitals" value={totalHospitals} icon={FiActivity} sparkColor="var(--v-orange)" />
          <StatCard label="Active Users"    value={activeUsers}    icon={FiUsers}    sparkColor="var(--v-ink)" />
          <StatCard
            label="Pending Approvals"
            value={pendingCount}
            icon={FiCheckSquare}
            sparkColor="var(--v-orange)"
            highlight={pendingCount > 0}
          />
          <StatCard label="FL Rounds Completed" value={flRoundsCompleted} icon={FiCpu} sparkColor="var(--v-ink)" />
        </div>

        {/* Two-column: Recent activity + Active alerts */}
        <div className="v-two-col" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 24 }}>
          {/* Recent activity */}
          <motion.div variants={cardVariants} className="v-card">
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--v-line-2)' }}>
              <div>
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Recent Approvals</div>
                <div style={{ fontSize: 12, color: 'var(--v-ink-3)', marginTop: 2 }}>System-wide activity feed</div>
              </div>
              <Link to="/admin/approvals" className="v-btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
                See all <FiArrowRight style={{ width: 13, height: 13 }} />
              </Link>
            </div>
            {recent.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v-ink-3)' }}>
                <FiActivity style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.4 }} />
                <p style={{ margin: 0 }}>No recent system activity.</p>
              </div>
            ) : (
              recent.slice(0, 5).map((a, i) => (
                <div
                  key={a.log_id || i}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 20px',
                    borderBottom: i < Math.min(recent.length, 5) - 1 ? '1px solid var(--v-line-2)' : 'none',
                    animation: `vRowIn 380ms var(--v-ease) ${i * 60}ms both`,
                  }}
                >
                  <div
                    style={{
                      width: 32, height: 32, borderRadius: 9,
                      background: 'linear-gradient(135deg, #F97316, #C9341A)',
                      color: '#fff', display: 'grid', placeItems: 'center',
                      fontWeight: 700, fontSize: 13, flexShrink: 0,
                      fontFamily: 'Bricolage Grotesque, system-ui, sans-serif',
                    }}
                  >
                    {String((a.action || a.description || a.message || 'S')[0] || 'S').toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.action || a.description || a.message || 'System action'}
                    </div>
                    {a.module && (
                      <div style={{ fontSize: 11, color: 'var(--v-ink-3)', textTransform: 'capitalize' }}>{a.module}</div>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--v-ink-3)', flexShrink: 0 }}>
                    {fmtTime(a.created_at || a.timestamp || a.logged_at)}
                  </div>
                </div>
              ))
            )}
          </motion.div>

          {/* Active alerts */}
          <motion.div variants={cardVariants} className="v-card">
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--v-line-2)' }}>
              <div>
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Active Alerts</div>
                <div style={{ fontSize: 12, color: 'var(--v-ink-3)', marginTop: 2 }}>{spikes.length} open epidemic spike{spikes.length === 1 ? '' : 's'}</div>
              </div>
              <Link to="/admin/epidemic" className="v-btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
                View all <FiArrowRight style={{ width: 13, height: 13 }} />
              </Link>
            </div>
            {spikes.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v-ink-3)' }}>
                <p style={{ fontSize: 28, margin: '0 0 6px' }}>🟢</p>
                <p style={{ margin: 0, fontSize: 13 }}>No active epidemic spikes.</p>
              </div>
            ) : (
              spikes.slice(0, 5).map((t, i) => {
                const chip = ALERT_CHIP[t.alert_level] || ALERT_CHIP.low;
                return (
                  <div
                    key={t.trend_id}
                    style={{
                      display: 'flex', gap: 12, padding: '12px 20px',
                      borderBottom: i < Math.min(spikes.length, 5) - 1 ? '1px solid var(--v-line-2)' : 'none',
                      animation: `vRowIn 380ms var(--v-ease) ${i * 60}ms both`,
                    }}
                  >
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                        background: '#FEF2F2', color: '#DC2626',
                        display: 'grid', placeItems: 'center',
                      }}
                    >
                      <FiAlertTriangle style={{ width: 16, height: 16 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t.disease_name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--v-ink-3)' }}>
                        {(t.region || '—')} · {t.case_count} cases
                      </div>
                    </div>
                    <span
                      style={{
                        alignSelf: 'center', fontSize: 11, fontWeight: 600,
                        padding: '3px 9px', borderRadius: 999,
                        background: chip.bg, color: chip.color,
                      }}
                    >
                      {chip.label}
                    </span>
                  </div>
                );
              })
            )}
          </motion.div>
        </div>

        {/* FL accuracy trend (kept) */}
        <motion.div variants={cardVariants} className="v-card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--v-line-2)' }}>
            <div>
              <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
                Federated Learning Accuracy
              </div>
              <div style={{ fontSize: 12, color: 'var(--v-ink-3)', marginTop: 2 }}>
                {flRoundsCompleted} round{flRoundsCompleted === 1 ? '' : 's'} completed
              </div>
            </div>
            <Link to="/admin/fl" className="v-btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
              Open FL Monitor <FiArrowRight style={{ width: 13, height: 13 }} />
            </Link>
          </div>
          <div style={{ padding: 20 }}>
            {accuracyTrend.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--v-ink-3)', padding: '36px 12px', fontSize: 14 }}>
                No completed FL rounds yet. Open{' '}
                <Link to="/admin/fl" style={{ color: '#F97316' }}>FL Monitor</Link>{' '}
                to run a round.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={accuracyTrend} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                  <XAxis dataKey="round" stroke="#666666" fontSize={12} />
                  <YAxis domain={[0, 100]} unit="%" stroke="#666666" fontSize={12} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E5E5' }}
                    formatter={(v) => [`${v}%`, 'Accuracy']}
                  />
                  <Line type="monotone" dataKey="accuracy" stroke="#F97316" strokeWidth={3} dot={{ fill: '#F97316', r: 5 }} activeDot={{ r: 7 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  );
};

export default SuperAdminDashboard;
