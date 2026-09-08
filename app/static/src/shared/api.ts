/**
 * apiFetch — wrapper de fetch con Authorization y renovación automática de token.
 *
 * - Adjunta `Authorization: Bearer <access_token>` (salvo que se pase otra).
 * - Si la respuesta es 401, intenta UNA vez renovar el access token con
 *   `POST /api/v1/auth/refresh` usando el refresh token guardado, y reintenta.
 * - Si la renovación falla, limpia la sesión y manda a /login.
 *
 * Uso: `const res = await apiFetch('/api/v1/users_mgmt/profile-image', { method: 'PATCH', body: ... })`
 */

let refreshing: Promise<string | null> | null = null;

function clearSessionAndRedirect() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
  } catch {
    /* ignore */
  }
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = '/login?expired=1';
  }
}

async function refreshAccessToken(): Promise<string | null> {
  // Coalesce: si ya hay un refresh en curso, esperamos ese mismo.
  if (refreshing) return refreshing;

  refreshing = (async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) return null;
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.access_token) {
        localStorage.setItem('token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        return data.access_token as string;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('token');

  const buildHeaders = (accessToken: string | null): HeadersInit => {
    const h = new Headers(init.headers || {});
    if (accessToken && !h.has('Authorization')) h.set('Authorization', `Bearer ${accessToken}`);
    return h;
  };

  let res = await fetch(input, { ...init, headers: buildHeaders(token) });

  if (res.status !== 401) return res;

  // 401 -> intentar renovar y reintentar una sola vez
  const newToken = await refreshAccessToken();
  if (!newToken) {
    clearSessionAndRedirect();
    return res;
  }

  res = await fetch(input, { ...init, headers: buildHeaders(newToken) });
  if (res.status === 401) clearSessionAndRedirect();
  return res;
}
