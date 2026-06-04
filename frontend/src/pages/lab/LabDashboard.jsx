import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FiClipboard, FiLoader, FiCheckCircle, FiFileText, FiUpload, FiList } from 'react-icons/fi';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

import DashboardLayout from '../../components/common/DashboardLayout';
import DashboardHeader from '../../components/dashboard/DashboardHeader';
import StatsCard from '../../components/dashboard/StatsCard';
import QuickActionCard from '../../components/dashboard/QuickActionCard';
import { pageVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import API from '../../api/axios';

const CIRCLE_RADIUS = 32;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

const barColor = (rate) => {
  if (rate >= 80) return '#22C55E';
  if (rate >= 50) return '#F97316';
  return '#EF4444';
};

const rateLabel = (rate) => {
  if (rate >= 80) return '🎉 Excellent!';
  if (rate >= 50) return '⚡ Good progress!';
  return '⏳ Keep going!';
};

const LabDashboard = () => {
  const { data: stats } = useApi('/api/lab/dashboard/');
  const { data: ordersData } = useApi('/api/lab/orders/');

  const s = ordersData?.stats || {};

  const [completionStats, setCompletionStats] = useState(null);
  useEffect(() => {
    const fetchCompletionStats = async () => {
      try {
        const res = await API.get('/api/lab/completion-stats/');
        if (res.data?.success) setCompletionStats(res.data.data);
      } catch (e) {
        /* best-effort */
      }
    };
    fetchCompletionStats();
    const id = setInterval(fetchCompletionStats, 60000);
    return () => clearInterval(id);
  }, []);

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible">
        <DashboardHeader
          title="Lab Dashboard"
          subtitle={[stats?.lab_tech_name, stats?.hospital_name].filter(Boolean).join(' · ') || 'Diagnostics'}
        />

        {/* ─── Combined stats (doctor-referred + self-booked) ─────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <StatsCard icon={FiList}        title="Total Orders"    value={s.total ?? 0} />
          <StatsCard icon={FiClipboard}   title="Pending"         value={s.pending ?? 0} />
          <StatsCard icon={FiLoader}      title="Processing"      value={s.processing ?? 0} />
          <StatsCard icon={FiCheckCircle} title="Completed Today" value={stats?.completed_today ?? 0} />
        </div>

        {/* ─── Source breakdown ───────────────────────────────────── */}
        <div className="flex flex-wrap gap-3 mb-8">
          <span className="text-sm px-4 py-2 rounded-full font-medium bg-gray-100 text-gray-700">
            👨‍⚕️ Doctor Referred: {s.doctor_referred ?? 0}
          </span>
          <span className="text-sm px-4 py-2 rounded-full font-medium" style={{ backgroundColor: '#FFF7ED', color: '#F97316' }}>
            👤 Self-Booked: {s.patient_bookings ?? 0}
          </span>
        </div>

        {/* ─── Today's progress ───────────────────────────────────── */}
        {completionStats && (
          <div className="bg-white rounded-2xl p-6 border border-gray-100 mb-6">
            {/* Header + circular rate */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-bold text-lg">📊 Today's Progress</h3>
                <p className="text-gray-500 text-sm">
                  {new Date().toLocaleDateString('en-IN', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </p>
              </div>

              <div className="text-center">
                <div className="relative w-20 h-20">
                  <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r={CIRCLE_RADIUS} fill="none" stroke="#E5E5E5" strokeWidth="8" />
                    <circle
                      cx="40" cy="40" r={CIRCLE_RADIUS}
                      fill="none"
                      stroke="#F97316"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={CIRCLE_CIRCUMFERENCE}
                      strokeDashoffset={CIRCLE_CIRCUMFERENCE * (1 - completionStats.today.completion_rate / 100)}
                      style={{ transition: 'stroke-dashoffset 1s ease' }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="font-bold text-sm text-black">
                      {completionStats.today.completion_rate}%
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-1">Complete</p>
              </div>
            </div>

            {/* Main progress bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-black">Overall Completion</span>
                <span className="text-sm font-bold" style={{ color: '#F97316' }}>
                  {completionStats.today.completed}/{completionStats.today.total} tests
                </span>
              </div>
              <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{
                    width: `${completionStats.today.completion_rate}%`,
                    backgroundColor: barColor(completionStats.today.completion_rate),
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>0%</span>
                <span>{rateLabel(completionStats.today.completion_rate)}</span>
                <span>100%</span>
              </div>
            </div>

            {/* 4 stat boxes */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-black">{completionStats.today.total}</p>
                <p className="text-xs text-gray-500 mt-1">Total Today</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: '#F0FDF4' }}>
                <p className="text-2xl font-bold text-green-600">{completionStats.today.completed}</p>
                <p className="text-xs text-green-500 mt-1">✅ Completed</p>
              </div>
              <div className="rounded-xl p-3 text-center" style={{ backgroundColor: '#FFF7ED' }}>
                <p className="text-2xl font-bold" style={{ color: '#F97316' }}>
                  {completionStats.today.processing}
                </p>
                <p className="text-xs mt-1" style={{ color: '#EA580C' }}>⚡ Processing</p>
              </div>
              <div className="bg-red-50 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{completionStats.today.pending}</p>
                <p className="text-xs text-red-400 mt-1">⏳ Pending</p>
              </div>
            </div>

            {/* Source breakdown */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">👨‍⚕️ Doctor Referred</p>
                <p className="font-bold text-lg">{completionStats.today.doctor_referred}</p>
                <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: completionStats.today.total > 0
                        ? `${(completionStats.today.doctor_referred / completionStats.today.total) * 100}%`
                        : '0%',
                      backgroundColor: '#F97316',
                    }}
                  />
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3">
                <p className="text-xs text-gray-500 mb-1">👤 Self-Booked</p>
                <p className="font-bold text-lg">{completionStats.today.self_booked}</p>
                <div className="h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-black"
                    style={{
                      width: completionStats.today.total > 0
                        ? `${(completionStats.today.self_booked / completionStats.today.total) * 100}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Weekly chart */}
            <div>
              <p className="font-semibold mb-3 text-sm text-gray-700">📈 Last 7 Days</p>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={completionStats.daily_breakdown}
                  margin={{ top: 5, right: 5, left: -20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: '12px', border: '1px solid #E5E5E5' }} />
                  <Legend />
                  <Bar dataKey="total"     name="Total"     fill="#E5E5E5" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#F97316" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Weekly summary */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
              <div>
                <p className="text-xs text-gray-500">Weekly Completion Rate</p>
                <p className="font-bold text-lg" style={{ color: '#F97316' }}>
                  {completionStats.weekly.completion_rate}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Total This Week</p>
                <p className="font-bold text-lg">
                  {completionStats.weekly.completed}/{completionStats.weekly.total}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── Quick actions ─────────────────────────────────────── */}
        <section>
          <h2 className="dash-h2">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <QuickActionCard icon={FiClipboard} to="/lab/orders"  title="View Test Orders" description={`${s.pending ?? 0} pending`} />
            <QuickActionCard icon={FiUpload}    to="/lab/orders"  title="Upload Reports"   description="Attach results to orders" />
            <QuickActionCard icon={FiFileText}  to="/lab/reports" title="View Reports"     description={`${stats?.flagged_reports ?? 0} flagged`} />
          </div>
        </section>
      </motion.div>
    </DashboardLayout>
  );
};

export default LabDashboard;
