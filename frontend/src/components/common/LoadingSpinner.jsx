const LoadingSpinner = ({ message = 'Loading FederCare...' }) => (
  <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-light">
    <div className="flex items-center gap-2 mb-6">
      <span className="text-3xl text-accent">⚕</span>
      <span className="text-2xl font-bold text-primary-500">FederCare</span>
    </div>
    <div className="relative">
      <div className="h-14 w-14 rounded-full border-4 border-primary-100" />
      <div className="absolute inset-0 h-14 w-14 rounded-full border-4 border-primary-500 border-t-transparent animate-spin" />
    </div>
    <p className="mt-5 text-sm text-gray-500">{message}</p>
  </div>
);

export default LoadingSpinner;
