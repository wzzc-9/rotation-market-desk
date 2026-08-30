const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export function apiFetch(path: string, init?: RequestInit) {
  if (!path.startsWith('/api/')) throw new Error(`API 路径必须以 /api/ 开头：${path}`);
  return fetch(`${apiBaseUrl}${path}`, init);
}
