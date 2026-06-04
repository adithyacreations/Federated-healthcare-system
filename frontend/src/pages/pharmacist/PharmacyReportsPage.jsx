import MonthlyReport from '../../components/reports/MonthlyReport';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function PharmacyReportsPage() {
  return (
    <MonthlyReport
      title="Monthly Report"
      subtitle="Medicine orders and revenue"
      endpoint="/api/pharmacy/monthly-report/"
      summaryCards={(r) => [
        { label: 'Total Orders', value: r.summary.total_orders, icon: '💊', color: '#F97316' },
        { label: 'Delivered', value: r.summary.delivered, icon: '✅', color: '#22C55E' },
        { label: 'Pending', value: r.summary.pending, icon: '⏳', color: '#3B82F6' },
        { label: 'Total Revenue', value: inr(r.summary.total_revenue), icon: '💰', color: '#8B5CF6' },
      ]}
      breakdownTitle="💊 Medicine Breakdown"
      breakdownColumns={[
        { key: 'medicine_name', label: 'Medicine Name' },
        { key: 'orders', label: 'Orders', color: '#F97316', bold: true },
        { key: 'strips_sold', label: 'Strips Sold', color: '#111', bold: true },
        { key: 'revenue', label: 'Revenue', color: '#22C55E', bold: true, format: inr },
      ]}
      breakdownRows={(r) => r.medicine_breakdown || []}
      buildCsvRows={(r) => [
        ['Pharmacy Monthly Report'],
        [`${r.month} ${r.year}`],
        [`Pharmacy: ${r.pharmacy}`],
        [],
        ['Summary'],
        ['Total Orders', r.summary.total_orders],
        ['Delivered', r.summary.delivered],
        ['Pending', r.summary.pending],
        ['Cancelled', r.summary.cancelled],
        ['Total Revenue', r.summary.total_revenue],
        [],
        ['Medicine Breakdown'],
        ['Medicine Name', 'Orders', 'Strips Sold', 'Revenue'],
        ...(r.medicine_breakdown || []).map((m) => [m.medicine_name, m.orders, m.strips_sold, m.revenue]),
      ]}
      csvFilename={(r) => `pharmacy_report_${r.month}_${r.year}.csv`}
    />
  );
}
