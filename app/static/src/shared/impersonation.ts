/**
 * "Ver como" — permite a un Admin navegar el sistema con una cuenta de
 * prueba (sombra) de otro rol, sin perder su propia sesión.
 *
 * Mecánica: antes de cambiar, se guarda el token/usuario ACTUAL en una
 * llave aparte ("respaldo"). Se sobreescriben token/usuario activos con los
 * de la cuenta sombra y se navega de golpe (recarga dura) a esa vista.
 * Volver a Admin = restaurar el respaldo y recargar. Así el banner de salida
 * (ImpersonationBanner) no depende de qué dashboard esté activo: solo mira
 * si existe un respaldo guardado.
 */

const BACKUP_TOKEN_KEY = 'admin_backup_token';
const BACKUP_REFRESH_KEY = 'admin_backup_refresh_token';
const BACKUP_USER_KEY = 'admin_backup_user';
const IMPERSONATION_INFO_KEY = 'impersonation_info';

export interface ImpersonationInfo {
  adminName: string;
  role: string;
}

export function isImpersonating(): boolean {
  try {
    return !!localStorage.getItem(BACKUP_TOKEN_KEY);
  } catch {
    return false;
  }
}

export function getImpersonationInfo(): ImpersonationInfo | null {
  try {
    const raw = localStorage.getItem(IMPERSONATION_INFO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const ROLE_HOME: Record<string, string> = {
  APRENDIZ: '/dashboard',
  BIBLIOTECARIO: '/bibliotecario',
  ALMACENISTA: '/almacenista',
  SOPORTE_TECNICO: '/soporte',
};

/** Pide al backend una sesión de la cuenta sombra del rol indicado y cambia
 * de inmediato a esa vista (recarga dura). Se llama SIEMPRE partiendo de la
 * sesión real de Admin (si ya se está "viendo como" otro rol, primero hay
 * que volver con exitImpersonation()). */
export async function switchToRole(role: string, adminName: string): Promise<{ ok: boolean; error?: string }> {
  const token = localStorage.getItem('token');
  const res = await fetch('/api/v1/auth/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data.error || 'No se pudo cambiar de vista.' };
  }

  // Guardar el respaldo SOLO si no existe ya uno (evita pisar la cuenta real
  // de Admin si se está saltando de un rol sombra a otro).
  if (!localStorage.getItem(BACKUP_TOKEN_KEY)) {
    localStorage.setItem(BACKUP_TOKEN_KEY, localStorage.getItem('token') || '');
    localStorage.setItem(BACKUP_REFRESH_KEY, localStorage.getItem('refresh_token') || '');
    localStorage.setItem(BACKUP_USER_KEY, localStorage.getItem('user') || '');
  }

  localStorage.setItem('token', data.access_token);
  localStorage.setItem('refresh_token', data.refresh_token);
  localStorage.setItem('user', JSON.stringify(data.user));
  localStorage.setItem(IMPERSONATION_INFO_KEY, JSON.stringify({ adminName, role }));

  window.location.href = ROLE_HOME[role] || '/';
  return { ok: true };
}

/** Restaura la sesión real de Admin y vuelve a su panel. */
export function exitImpersonation() {
  const token = localStorage.getItem(BACKUP_TOKEN_KEY);
  const refresh = localStorage.getItem(BACKUP_REFRESH_KEY);
  const user = localStorage.getItem(BACKUP_USER_KEY);
  if (!token) return;

  localStorage.setItem('token', token);
  if (refresh) localStorage.setItem('refresh_token', refresh);
  if (user) localStorage.setItem('user', user);

  localStorage.removeItem(BACKUP_TOKEN_KEY);
  localStorage.removeItem(BACKUP_REFRESH_KEY);
  localStorage.removeItem(BACKUP_USER_KEY);
  localStorage.removeItem(IMPERSONATION_INFO_KEY);

  window.location.href = '/admin';
}
