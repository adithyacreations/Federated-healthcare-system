import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import DashboardLayout from '../../components/common/DashboardLayout';
import API from '../../api/axios';

const severityColor = {
  critical: '#EF4444',
  high: '#F97316',
  moderate: '#EAB308',
  low: '#22C55E',
};

const severityEmoji = {
  critical: '🔴',
  high: '🟠',
  moderate: '🟡',
  low: '🟢',
};

const severityTextClass = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  moderate: 'text-yellow-600',
  low: 'text-green-600',
};

const severityDotClass = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  moderate: 'bg-yellow-500',
  low: 'bg-green-500',
};

const responseBadge = (mins) => {
  if (mins <= 10) return { cls: 'bg-green-100 text-green-700', label: '🏆 Excellent' };
  if (mins <= 20) return { cls: 'bg-orange-100 text-orange-700', label: '👍 Good' };
  return { cls: 'bg-red-100 text-red-700', label: '⚡ Needs Improvement' };
};

const TripHistoryPage = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await API.get('/api/emergency/driver/trip-stats/');
        if (res.data?.success) setStats(res.data.data);
      } catch (e) {
        /* best-effort */
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const totalForSeverity = stats?.total_trips || 0;
  const badge = stats ? responseBadge(stats.avg_response_time) : null;

  return (
    <DashboardLayout>
      <div className="p-6 min-h-screen" style={{ backgroundColor: '#FAF7F2' }}>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-black">📊 Trip Statistics</h1>
          <p className="text-gray-500 text-sm">Your emergency response record</p>
        </div>

        {loading && (
          <div className="text-center py-12">
            <p className="text-gray-400">Loading statistics...</p>
          </div>
        )}

        {stats && (
          <>
            {/* ─── Hero stats ────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-2xl p-5 border border-gray-100 text-center">
                <p className="text-4xl font-bold text-black">{stats.total_trips}</p>
                <p className="text-gray-500 text-sm mt-1">🚑 Total Trips</p>
              </div>
              <div className="rounded-2xl p-5 text-center" style={{ backgroundColor: '#FFF7ED' }}>
                <p className="text-4xl font-bold" style={{ color: '#F97316' }}>{stats.today_trips}</p>
                <p className="text-sm mt-1" style={{ color: '#EA580C' }}>📅 Today</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 text-center">
                <p className="text-4xl font-bold text-black">{stats.weekly_trips}</p>
                <p className="text-gray-500 text-sm mt-1">📆 This Week</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100 text-center">
                <p className="text-4xl font-bold text-black">{stats.monthly_trips}</p>
                <p className="text-gray-500 text-sm mt-1">🗓️ This Month</p>
              </div>
            </div>

            {/* ─── Performance cards ────────────────────────────── */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="bg-white rounded-2xl p-5 border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">⚡ Avg Response Time</p>
                <p className="text-3xl font-bold text-black">
                  {stats.avg_response_time}
                  <span className="text-lg font-normal text-gray-400 ml-1">min</span>
                </p>
                <span className={`text-xs px-2 py-1 rounded-full font-medium mt-2 inline-block ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-gray-100">
                <p className="text-xs text-gray-500 mb-1">🗺️ Total Distance</p>
                <p className="text-3xl font-bold text-black">
                  {stats.total_km}
                  <span className="text-lg font-normal text-gray-400 ml-1">km</span>
                </p>
                <p className="text-xs text-gray-400 mt-2">Across all emergency trips</p>
              </div>
            </div>

            {/* ─── Weekly chart ─────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-6">
              <h3 className="font-bold mb-4">📈 Last 7 Days</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={stats.daily_breakdown}
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: '1px solid #E5E5E5' }}
                    formatter={(value) => [`${value} trips`, 'Trips']}
                  />
                  <Bar dataKey="trips" fill="#F97316" radius={[6, 6, 0, 0]} name="Trips" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* ─── Severity breakdown ───────────────────────────── */}
            {Object.keys(stats.severity_breakdown).length > 0 && (
              <div className="bg-white rounded-2xl p-5 border border-gray-100 mb-6">
                <h3 className="font-bold mb-4">🚨 By Severity</h3>
                <div className="space-y-3">
                  {Object.entries(stats.severity_breakdown).map(([severity, count]) => (
                    <div key={severity}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-medium capitalize ${severityTextClass[severity] || 'text-gray-600'}`}>
                          {severityEmoji[severity] || '⚪'} {severity}
                        </span>
                        <span className="text-sm font-bold">{count} trips</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: totalForSeverity > 0
                              ? `${(count / totalForSeverity) * 100}%`
                              : '0%',
                            backgroundColor: severityColor[severity] || '#9CA3AF',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ─── Recent trips ─────────────────────────────────── */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100">
              <h3 className="font-bold mb-4">🕐 Recent Trips</h3>

              {stats.recent_trips.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-4xl mb-2">🚑</p>
                  <p className="text-gray-400">No completed trips yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.recent_trips.map((trip) => (
                    <div
                      key={trip.dispatch_id}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl"
                    >
                      <div className={`w-3 h-3 rounded-full flex-shrink-0 ${severityDotClass[trip.severity] || 'bg-gray-400'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-black truncate">
                          👤 {trip.patient_name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          🏥 {trip.hospital_name}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-medium text-black">{trip.date}</p>
                        <p className="text-xs text-gray-400">{trip.time}</p>
                        {trip.distance_km > 0 && (
                          <p className="text-xs font-medium mt-1" style={{ color: '#F97316' }}>
                            {trip.distance_km} km
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default TripHistoryPage;
