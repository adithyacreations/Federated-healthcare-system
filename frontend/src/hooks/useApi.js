import { useState, useEffect, useCallback, useRef } from 'react';
import API from '../api/axios';

/**
 * Tiny data-fetching hook used by all dashboard widgets.
 *
 *   const { data, loading, error, refetch } = useApi('/api/hospital/dashboard/');
 *   useApi(url, { enabled: false }) — skip the initial fetch
 *   useApi(url, { params: { page: 2 } }) — pass query params
 *   useApi(url, { unwrap: true }) — return res.data.data when backend wraps in {success, data}
 */
const useApi = (url, options = {}) => {
  const { params, enabled = true, unwrap = true, pollInterval = 0 } = options;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(url) && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  // Stable reference to params so deep-equal users don't re-trigger by accident
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // `silent === true` runs a background refresh (e.g. polling / manual button)
  // without flipping `loading`, so lists don't flash their loading state.
  const fetchOnce = useCallback(async (arg) => {
    if (!url) return;
    const silent = arg === true;
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await API.get(url, { params: paramsRef.current });
      const payload = res.data;
      const value = unwrap && payload && typeof payload === 'object' && 'success' in payload
        ? payload.data
        : payload;
      setData(value);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [url, unwrap]);

  useEffect(() => {
    if (!enabled) return;
    fetchOnce();
  }, [fetchOnce, enabled]);

  useEffect(() => {
    if (!enabled || !pollInterval || !url) return undefined;
    const id = setInterval(() => fetchOnce(true), pollInterval);
    return () => clearInterval(id);
  }, [fetchOnce, enabled, pollInterval, url]);

  return { data, loading, error, refetch: fetchOnce, refreshing, lastUpdated };
};

export default useApi;
