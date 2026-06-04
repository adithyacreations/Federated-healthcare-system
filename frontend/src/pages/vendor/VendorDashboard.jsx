import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FiPlus, FiArrowRight, FiBox, FiShoppingCart, FiPackage, FiDollarSign,
} from 'react-icons/fi';

import DashboardLayout from '../../components/common/DashboardLayout';
import { pageVariants, cardVariants } from '../../components/dashboard/variants';
import useApi from '../../hooks/useApi';
import { colorFor, initials, STATUS_LABEL } from './vendorHelpers';
import './vendor-design.css';

// Tiny inline sparkline — deterministic 8-point series derived from a number so
// each stat tile gets its own consistent shape without any randomness on render.
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
  const max = Math.max(...data), min = Math.min(...data);
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

const StatCard = ({ label, value, icon: Icon, sparkColor }) => (
  <div className="v-stat">
    <div className="v-stat-label">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Icon style={{ width: 13, height: 13, color: 'var(--v-orange)' }} />
        {label}
      </span>
    </div>
    <div className="v-stat-value">{value}</div>
    <Sparkline seed={Number(String(value).replace(/\D/g, '')) || 7} color={sparkColor} />
  </div>
);

const VendorDashboard = () => {
  const { data: stats } = useApi('/api/vendor/dashboard/');
  const { data: ordersRaw } = useApi('/api/vendor/orders/');
  const { data: chatsRes } = useApi('/api/vendor/chats/');

  const orders = Array.isArray(ordersRaw) ? ordersRaw : [];
  const chats = chatsRes?.data || chatsRes || [];
  const unreadChats = useMemo(
    () => (Array.isArray(chats) ? chats : [])
      .filter((c) => (c.unread_count || 0) > 0)
      .slice(0, 3),
    [chats],
  );

  const totalProducts = stats?.total_products ?? 0;
  const pendingOrders = stats?.pending_orders ?? orders.filter((o) => o.order_status === 'pending').length;
  const dispatchedCount = stats?.dispatched_orders ?? orders.filter((o) => o.order_status === 'dispatched').length;
  const revenue = Number(stats?.total_revenue ?? 0);

  const recent = orders.slice(0, 3);
  const company = stats?.company_name || 'Vendor';

  return (
    <DashboardLayout>
      <motion.div variants={pageVariants} initial="hidden" animate="visible" className="v-scope v-page">
        {/* Page head */}
        <div className="v-page-head">
          <div>
            <h1 className="v-page-title">
              Hi, {company} <span className="accent">·</span> today
            </h1>
            <p className="v-page-sub">Here&apos;s what&apos;s happening across your hospitals.</p>
          </div>
          <div className="v-page-actions">
            <Link to="/vendor/orders" className="v-btn-ghost">
              <FiShoppingCart style={{ width: 14, height: 14 }} /> View orders
            </Link>
            <Link to="/vendor/products/add" className="v-btn-primary">
              <FiPlus style={{ width: 14, height: 14 }} /> Add product
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="v-stats">
          <StatCard label="Total Products"    value={totalProducts}                          icon={FiBox}          sparkColor="var(--v-orange)" />
          <StatCard label="Pending Orders"    value={pendingOrders}                          icon={FiShoppingCart} sparkColor="var(--v-ink)" />
          <StatCard label="Dispatched Orders" value={dispatchedCount}                        icon={FiPackage}      sparkColor="var(--v-orange)" />
          <StatCard label={`Revenue (₹)`}     value={`₹${revenue.toLocaleString('en-IN')}`}  icon={FiDollarSign}   sparkColor="var(--v-ink)" />
        </div>

        {/* Two-column: recent orders + unread messages */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 24 }} className="v-two-col">
          <motion.div variants={cardVariants} className="v-card">
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--v-line-2)' }}>
              <div>
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Recent orders</div>
                <div style={{ fontSize: 12, color: 'var(--v-ink-3)', marginTop: 2 }}>Last orders received</div>
              </div>
              <Link to="/vendor/orders" className="v-btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
                See all <FiArrowRight style={{ width: 13, height: 13 }} />
              </Link>
            </div>
            {recent.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v-ink-3)' }}>
                <FiShoppingCart style={{ width: 28, height: 28, margin: '0 auto 8px', opacity: 0.4 }} />
                <p style={{ margin: 0 }}>No orders yet.</p>
              </div>
            ) : (
              recent.map((o, i) => {
                const [c1, c2] = colorFor(o.hospital_name);
                return (
                  <div
                    key={o.eq_order_id}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 110px 120px', alignItems: 'center', gap: 12,
                      padding: '12px 20px',
                      borderBottom: i < recent.length - 1 ? '1px solid var(--v-line-2)' : 'none',
                      animation: `vRowIn 380ms var(--v-ease) ${i * 60}ms both`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <div
                        className="v-hosp-mark"
                        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})`, width: 30, height: 30, borderRadius: 8, fontSize: 11 }}
                      >
                        {initials(o.hospital_name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.hospital_name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--v-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {o.product_name} · Qty {o.quantity}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontWeight: 700, fontSize: 14 }}>
                      ₹{Number(o.total_price || 0).toLocaleString('en-IN')}
                    </div>
                    <span className={`v-status ${o.order_status}`}>
                      <span className="pip" />
                      {STATUS_LABEL[o.order_status] || o.order_status}
                    </span>
                  </div>
                );
              })
            )}
          </motion.div>

          <motion.div variants={cardVariants} className="v-card">
            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--v-line-2)' }}>
              <div>
                <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>Unread messages</div>
                <div style={{ fontSize: 12, color: 'var(--v-ink-3)', marginTop: 2 }}>{unreadChats.length} new thread{unreadChats.length === 1 ? '' : 's'}</div>
              </div>
              <Link to="/vendor/messages" className="v-btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
                Open inbox <FiArrowRight style={{ width: 13, height: 13 }} />
              </Link>
            </div>
            {unreadChats.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--v-ink-3)' }}>
                <p style={{ fontSize: 28, margin: '0 0 6px' }}>💬</p>
                <p style={{ margin: 0, fontSize: 13 }}>You&apos;re all caught up.</p>
              </div>
            ) : (
              unreadChats.map((c, i) => {
                const [a, b] = colorFor(c.hospital_name || 'Hospital');
                return (
                  <Link
                    key={c.chat_id || i}
                    to="/vendor/messages"
                    style={{
                      display: 'flex', gap: 11, padding: '12px 20px',
                      borderBottom: i < unreadChats.length - 1 ? '1px solid var(--v-line-2)' : 'none',
                      textDecoration: 'none', color: 'inherit',
                      animation: `vRowIn 380ms var(--v-ease) ${i * 60}ms both`,
                    }}
                  >
                    <div
                      className="v-conv-avatar"
                      style={{ background: `linear-gradient(135deg, ${a}, ${b})`, width: 36, height: 36, borderRadius: 9, fontSize: 12 }}
                    >
                      {initials(c.hospital_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.hospital_name}</div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--v-ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                        {c.last_message || 'New message'}
                      </div>
                    </div>
                    <span
                      style={{
                        alignSelf: 'center', background: 'var(--v-orange)', color: '#fff',
                        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                      }}
                    >
                      {c.unread_count}
                    </span>
                  </Link>
                );
              })
            )}
          </motion.div>
        </div>

        {/* Quick actions */}
        <motion.div
          variants={cardVariants}
          style={{
            background: 'var(--v-ink)', color: '#F3E8D0',
            borderRadius: 20, padding: '20px 24px',
            display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
          }}
        >
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--v-orange)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <FiBox style={{ width: 20, height: 20, color: '#fff' }} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: 'Bricolage Grotesque, system-ui, sans-serif', fontWeight: 700, color: '#fff', fontSize: 15 }}>
              Manage your catalog and orders
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(243,232,208,0.7)', marginTop: 2 }}>
              Add new equipment, confirm pending orders, and chat with hospitals — all in one place.
            </div>
          </div>
          <Link to="/vendor/products" className="v-btn-primary">
            Manage products <FiArrowRight style={{ width: 13, height: 13 }} />
          </Link>
        </motion.div>
      </motion.div>
    </DashboardLayout>
  );
};

export default VendorDashboard;
