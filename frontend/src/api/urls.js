const configuredUrl = process.env.REACT_APP_API_URL?.trim();
export const BACKEND_URL = (configuredUrl || 'http://localhost:8000')
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

export function backendUrl(path) {
  if (!path || /^(?:https?:|data:|blob:)/i.test(path)) return path;
  return `${BACKEND_URL}/${path.replace(/^\/+/, '')}`;
}

export function openBackendSocket(path) {
  const url = new URL(backendUrl(path));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = localStorage.getItem('access_token');
  return new WebSocket(url.href, token ? ['federcare.jwt', token] : []);
}
