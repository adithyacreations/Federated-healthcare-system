import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import API, { setAuthToken, setRefreshToken, removeAuthToken, getAuthToken } from '../api/axios';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [token, setTokenState] = useState(getAuthToken());
  const [loading, setLoading] = useState(true);

  const isAuthenticated = Boolean(token);

  const fetchProfile = useCallback(async () => {
    try {
      const { data } = await API.get('/api/auth/profile/');
      const payload = data?.data || data;
      const innerProfile = payload?.profile || payload?.user || payload;
      // Surface login_id + email + role onto the user object so callers (e.g.
      // chat WebSocket URLs) can use them without an extra round-trip.
      setUser({
        ...(innerProfile || {}),
        login_id: payload?.login_id || innerProfile?.login_id,
        email: payload?.email || innerProfile?.email,
        role: payload?.role || innerProfile?.role,
      });
      setRole(payload?.role || payload?.user?.role || localStorage.getItem('role'));
    } catch (err) {
      // 401 will be handled by interceptor
      removeAuthToken();
      setUser(null);
      setRole(null);
      setTokenState(null);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const stored = getAuthToken();
      if (stored) {
        setTokenState(stored);
        await fetchProfile();
      }
      setLoading(false);
    };
    init();
  }, [fetchProfile]);

  const login = async (email, password) => {
    const { data } = await API.post('/api/auth/login/', { email, password });
    const payload = data?.data || {};
    const accessToken = payload.access || payload.access_token || payload.token;
    const refreshToken = payload.refresh || payload.refresh_token;
    const userRole = payload.role || payload.user?.role;
    const innerProfile = payload.user || payload.profile || payload;
    // Same merge as fetchProfile so login_id is available immediately on login.
    const profile = {
      ...(innerProfile || {}),
      login_id: payload?.login_id || innerProfile?.login_id,
      email: payload?.email || innerProfile?.email,
      role: userRole,
    };

    if (!accessToken) {
      return { success: false, message: 'Login failed: missing token' };
    }

    setAuthToken(accessToken);
    setRefreshToken(refreshToken);
    if (userRole) localStorage.setItem('role', userRole);
    localStorage.setItem('user', JSON.stringify(profile));

    setTokenState(accessToken);
    setRole(userRole);
    setUser(profile);

    return { success: true, role: userRole };
  };

  const logout = async () => {
    try {
      await API.post('/api/auth/logout/');
    } catch (_) {
      // proceed even if backend logout fails
    }
    removeAuthToken();
    setUser(null);
    setRole(null);
    setTokenState(null);
    window.location.href = '/login';
  };

  const updateProfile = (data) => setUser((prev) => ({ ...(prev || {}), ...data }));

  return (
    <AuthContext.Provider
      value={{ user, role, token, isAuthenticated, loading, login, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
