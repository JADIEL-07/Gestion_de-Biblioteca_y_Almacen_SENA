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
let expiredOverlayShown = false;

/** Pantalla de "sesión expirada" (5 s) antes de mandar al inicio. Se inyecta en
 *  el DOM directamente para funcionar aunque React quede en mal estado. */
function showSessionExpiredOverlay(): void {
  if (expiredOverlayShown) return;
  expiredOverlayShown = true;

  let secs = 5;
  const el = document.createElement('div');
  el.id = 'session-expired-overlay';
  el.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:#0b1220;color:#e2e8f0;text-align:center;padding:24px;' +
    "font-family:Montserrat,system-ui,-apple-system,Segoe UI,Arial,sans-serif;";
  el.innerHTML =
    '<div style="max-width:420px">' +
    '<div style="width:84px;height:84px;margin:0 auto 20px;border-radius:50%;overflow:hidden;' +
    'box-shadow:0 8px 24px rgba(57,169,0,.28)">' +
    '<img src="/assets/images/icono-sena.png" alt="SENA" style="width:114%;height:114%;margin:-7%;' +
    'display:block;object-fit:cover;animation:se-spin 1s linear infinite" /></div>' +
    '<h2 style="margin:0 0 8px;font-size:1.35rem;color:#39A900">Tu sesión ha expirado</h2>' +
    '<p style="margin:0;color:#94a3b8;font-size:.95rem">Se cerró la sesión de este dispositivo. ' +
    'Te llevaremos al inicio en <span id="se-count">' + secs + '</span> segundos…</p>' +
    '</div><style>@keyframes se-spin{to{transform:rotate(360deg)}}</style>';

  try {
    document.body.appendChild(el);
    document.body.style.overflow = 'hidden';
  } catch {
    window.location.href = '/';
    return;
  }

  const iv = window.setInterval(() => {
    secs -= 1;
    const c = document.getElementById('se-count');
    if (c) c.textContent = String(Math.max(secs, 0));
    if (secs <= 0) {
      window.clearInterval(iv);
      window.location.href = '/';
    }
  }, 1000);
}

function clearSessionAndRedirect() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('force_password_change');
  } catch {
    /* ignore */
  }
  showSessionExpiredOverlay();
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
