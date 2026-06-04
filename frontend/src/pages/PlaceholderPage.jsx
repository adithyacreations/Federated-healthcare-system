import DashboardLayout from '../components/common/DashboardLayout';

const PlaceholderPage = ({ title, description = 'Coming soon — backend APIs are wired up; UI for this section is on the way.' }) => (
  <DashboardLayout>
    <div className="card">
      <h1 className="text-2xl font-bold text-primary-500">{title}</h1>
      <p className="text-gray-500 mt-2">{description}</p>
    </div>
  </DashboardLayout>
);

export default PlaceholderPage;
