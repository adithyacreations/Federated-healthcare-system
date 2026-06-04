import axios from 'axios';
import toast from 'react-hot-toast';

const BASE_URL = 'http://localhost:8000';

const API = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ─── Request: attach access token ───────────────────────────────────────────
API.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response: transparent token refresh on 401 ──────────────────────────────
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token);
  });
  failedQueue = [];
};

const forceLogout = () => {
  removeAuthToken();
  if (window.location.pathname !== '/login') {
    toast.error('Session expired. Please log in again.');
    window.location.href = '/login';
  }
};

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (!error.response) {
      toast.error('Network error. Check your connection or backend server.');
      return Promise.reject(error);
    }

    const originalRequest = error.config;
    const status = error.response.status;

    // Auto-refresh on 401 (once per request). Never try to refresh the
    // refresh-call itself.
    if (status === 401 && !originalRequest._retry && !originalRequest._isRefresh) {
      if (isRefreshing) {
        // Queue requests that arrive while a refresh is already in flight.
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return API(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (!refreshToken) {
        isRefreshing = false;
        forceLogout();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(
          `${BASE_URL}/api/auth/token/refresh/`,
          { refresh: refreshToken },
          { headers: { 'Content-Type': 'application/json' }, _isRefresh: true }
        );

        const newAccessToken = data.access;
        localStorage.setItem('access_token', newAccessToken);
        if (data.refresh) localStorage.setItem('refresh_token', data.refresh);

        processQueue(null, newAccessToken);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return API(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        forceLogout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    if (status >= 500) {
      toast.error('Server error. Please try again shortly.');
    }
    return Promise.reject(error);
  }
);

export const setAuthToken = (token) => {
  localStorage.setItem('access_token', token);
};

export const setRefreshToken = (token) => {
  if (token) localStorage.setItem('refresh_token', token);
};

export const removeAuthToken = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
  localStorage.removeItem('role');
};

export const getAuthToken = () => localStorage.getItem('access_token');

export default API;
