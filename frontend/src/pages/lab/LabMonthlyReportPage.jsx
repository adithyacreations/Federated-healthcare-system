import MonthlyReport from '../../components/reports/MonthlyReport';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function LabMonthlyReportPage() {
  return (
    <MonthlyReport
      title="Monthly Report"
      subtitle="Lab test orders and revenue"
      endpoint="/api/lab/monthly-report/"
      summaryCards={(r) => [
        { label: 'Total Orders', value: r.summary.total_orders, icon: '🔬', color: '#F97316' },
        { label: 'Completed', value: r.summary.completed, icon: '✅', color: '#22C55E' },
        { label: 'Total Revenue', value: inr(r.summary.total_revenue), icon: '💰', color: '#8B5CF6' },
        { label: 'Completion Rate', value: `${r.summary.completion_rate}%`, icon: '📈', color: '#F97316' },
      ]}
      breakdownTitle="🔬 Test Breakdown"
      breakdownColumns={[
        { key: 'test_name', label: 'Test Name' },
        { key: 'count', label: 'Orders', color: '#F97316', bold: true },
        { key: 'revenue', label: 'Revenue', color: '#22C55E', bold: true, format: inr },
      ]}
      breakdownRows={(r) => r.test_breakdown || []}
      buildCsvRows={(r) => [
        ['Lab Monthly Report'],
        [`${r.month} ${r.year}`],
        [`Hospital: ${r.hospital}`],
        [],
        ['Summary'],
        ['Total Orders', r.summary.total_orders],
        ['Completed', r.summary.completed],
        ['Pending', r.summary.pending],
        ['Processing', r.summary.processing],
        ['Cancelled', r.summary.cancelled],
        ['Total Revenue', r.summary.total_revenue],
        ['Completion Rate', `${r.summary.completion_rate}%`],
        [],
        ['Test Breakdown'],
        ['Test Name', 'Orders', 'Revenue'],
        ...(r.test_breakdown || []).map((t) => [t.test_name, t.count, t.revenue]),
        [],
        ['Daily Breakdown'],
        ['Date', 'Orders', 'Revenue'],
        ...(r.daily_breakdown || []).map((d) => [d.date, d.orders, d.revenue]),
      ]}
      csvFilename={(r) => `lab_report_${r.month}_${r.year}.csv`}
    />
  );
}
