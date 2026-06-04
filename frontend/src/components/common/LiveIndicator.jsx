/* Small "live" status pill: pulsing dot + last-updated time + manual refresh.
 * Pairs with useApi's { refreshing, lastUpdated, refetch }. */
const LiveIndicator = ({ refreshing, lastUpdated, onRefresh, label }) => (
  <div className="flex items-center gap-2">
    <div className={`w-2 h-2 rounded-full animate-pulse ${refreshing ? 'bg-yellow-400' : 'bg-green-400'}`} />
    <span className="text-xs text-gray-400">
      {refreshing
        ? 'Updating…'
        : label
        || (lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Live')}
    </span>
    {onRefresh && (
      <button
        onClick={() => onRefresh(true)}
        disabled={refreshing}
        className="text-xs px-3 py-1 rounded-full border border-gray-200 hover:bg-gray-50 transition-all disabled:opacity-50"
      >
        🔄 Refresh
      </button>
    )}
  </div>
);

export default LiveIndicator;
