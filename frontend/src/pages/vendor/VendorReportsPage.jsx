import MonthlyReport from '../../components/reports/MonthlyReport';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function VendorReportsPage() {
  return (
    <MonthlyReport
      title="Monthly Report"
      subtitle="Equipment orders and revenue"
      endpoint="/api/vendor/monthly-report/"
      summaryCards={(r) => [
        { label: 'Total Orders', value: r.summary.total_orders, icon: '📦', color: '#F97316' },
        { label: 'Delivered', value: r.summary.delivered, icon: '✅', color: '#22C55E' },
        { label: 'Total Revenue', value: inr(r.summary.total_revenue), icon: '💰', color: '#8B5CF6' },
        { label: 'Refunded', value: inr(r.summary.refunded_amount), icon: '💸', color: '#EF4444' },
      ]}
      breakdownTitle="📦 Equipment Breakdown"
      breakdownColumns={[
        { key: 'equipment_name', label: 'Equipment Name' },
        { key: 'orders', label: 'Orders', color: '#F97316', bold: true },
        { key: 'quantity_sold', label: 'Quantity Sold', color: '#111', bold: true },
        { key: 'revenue', label: 'Revenue', color: '#22C55E', bold: true, format: inr },
      ]}
      breakdownRows={(r) => r.equipment_breakdown || []}
      buildCsvRows={(r) => [
        ['Vendor Monthly Report'],
        [`${r.month} ${r.year}`],
        [`Vendor: ${r.vendor}`],
        [],
        ['Summary'],
        ['Total Orders', r.summary.total_orders],
        ['Delivered', r.summary.delivered],
        ['Pending', r.summary.pending],
        ['Cancelled', r.summary.cancelled],
        ['Total Revenue', r.summary.total_revenue],
        ['Refunded Amount', r.summary.refunded_amount],
        [],
        ['Equipment Breakdown'],
        ['Equipment Name', 'Orders', 'Quantity Sold', 'Revenue'],
        ...(r.equipment_breakdown || []).map((m) => [m.equipment_name, m.orders, m.quantity_sold, m.revenue]),
      ]}
      csvFilename={(r) => `vendor_report_${r.month}_${r.year}.csv`}
    />
  );
}
