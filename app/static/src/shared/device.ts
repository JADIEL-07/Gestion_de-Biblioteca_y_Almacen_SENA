// Identidad del dispositivo (navegador) y aceptación de T&C — todo por dispositivo,
// guardado en localStorage. Si el usuario borra los datos del sitio, vuelve a ser
// un dispositivo "nuevo" (y se le vuelven a pedir los T&C), que es el comportamiento esperado.

const DEVICE_KEY = 'device_id';
export const TOS_KEY = 'tos_accepted';

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return (crypto as Crypto).randomUUID();
    }
  } catch { /* ignore */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** UUID estable de este navegador. Se crea la primera vez y se reutiliza. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

/** ¿Ya se aceptaron los Términos y Condiciones en este dispositivo? */
export function hasAcceptedTos(): boolean {
  try {
    return !!localStorage.getItem(TOS_KEY);
  } catch {
    return false;
  }
}

/** Marca los T&C como aceptados en este dispositivo (no se vuelven a mostrar). */
export function markTosAccepted(): void {
  try {
    localStorage.setItem(TOS_KEY, new Date().toISOString());
  } catch { /* ignore */ }
}
