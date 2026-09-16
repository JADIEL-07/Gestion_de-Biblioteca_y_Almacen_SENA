import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiHelpCircle, FiInfo } from 'react-icons/fi';
import './ConfirmDialog.css';

export interface ConfirmOptions {
  /** Pregunta principal — equivalente al mensaje de window.confirm(). */
  message: string;
  /** Título opcional arriba del mensaje. */
  title?: string;
  confirmText?: string;
  cancelText?: string;
  /** Acciones destructivas (eliminar, cerrar definitivamente, etc.): ícono y botón en rojo. */
  danger?: boolean;
}

export interface AlertOptions {
  /** Mensaje — equivalente al de window.alert(). */
  message: string;
  title?: string;
  okText?: string;
  /** Errores/fallos: ícono en rojo en vez del verde por defecto. */
  danger?: boolean;
}

interface InternalState {
  mode: 'confirm' | 'alert';
  message: string;
  confirmText: string;
  cancelText: string;
  danger: boolean;
  title?: string;
  resolve: (value: boolean) => void;
}

// Suscriptor único: ConfirmDialogRoot (montado una vez en App.tsx) se registra
// aquí, así cualquier archivo puede pedir una confirmación con solo llamar a
// confirmDialog(...) — sin pasar por contexto ni props.
let _setState: ((state: InternalState | null) => void) | null = null;

/**
 * Reemplazo de window.confirm() con el mismo diseño del resto de la app
 * (misma tonalidad de tarjetas, mismos botones) en vez del cuadro feo y
 * genérico del navegador. Uso:
 *   if (!(await confirmDialog('¿Eliminar este elemento?'))) return;
 *   if (!(await confirmDialog({ message: '¿Eliminar?', danger: true }))) return;
 */
export function confirmDialog(arg: string | ConfirmOptions): Promise<boolean> {
  const options: ConfirmOptions = typeof arg === 'string' ? { message: arg } : arg;
  return new Promise((resolve) => {
    if (!_setState) {
      // Red de seguridad si por algún motivo ConfirmDialogRoot no está montado.
      resolve(window.confirm(options.message));
      return;
    }
    _setState({
      mode: 'confirm',
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || 'Aceptar',
      cancelText: options.cancelText || 'Cancelar',
      danger: !!options.danger,
      resolve,
    });
  });
}

/**
 * Reemplazo de window.alert() con el mismo diseño (una sola tarjeta con
 * botón "Aceptar"), para no mostrar el cuadro nativo del navegador con el
 * dominio ("sena.newonline.digital says..."). Uso:
 *   alertDialog('Tu reserva está lista.');
 *   await alertDialog('Guardado con éxito'); // si se necesita esperar el cierre
 */
export function alertDialog(arg: string | AlertOptions): Promise<void> {
  const options: AlertOptions = typeof arg === 'string' ? { message: arg } : arg;
  return new Promise((resolve) => {
    if (!_setState) {
      window.alert(options.message);
      resolve();
      return;
    }
    _setState({
      mode: 'alert',
      title: options.title,
      message: options.message,
      confirmText: options.okText || 'Aceptar',
      cancelText: '',
      danger: !!options.danger,
      resolve: () => resolve(),
    });
  });
}

/** Se monta UNA sola vez, fuera de <Routes>, para que esté disponible en
 * cualquier pantalla de cualquier rol (igual que ImpersonationBanner). */
export const ConfirmDialogRoot: React.FC = () => {
  const [state, setState] = useState<InternalState | null>(null);

  useEffect(() => {
    _setState = setState;
    return () => { _setState = null; };
  }, []);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) return null;

  const isAlert = state.mode === 'alert';

  const close = (result: boolean) => {
    state.resolve(result);
    setState(null);
  };

  return (
    <div className="confirm-dialog-overlay" onClick={() => close(false)}>
      <div className="confirm-dialog-wrap" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-dialog-card ${state.danger ? 'danger' : ''}`}>
          <div className="confirm-dialog-icon">
            {state.danger ? <FiAlertTriangle /> : isAlert ? <FiInfo /> : <FiHelpCircle />}
          </div>
          {state.title && <h3>{state.title}</h3>}
          <p>{state.message}</p>
          <div className="confirm-dialog-actions">
            {!isAlert && (
              <button className="confirm-dialog-btn cancel" onClick={() => close(false)} autoFocus>
                {state.cancelText}
              </button>
            )}
            <button
              className={`confirm-dialog-btn confirm ${state.danger ? 'danger' : ''}`}
              onClick={() => close(true)}
              autoFocus={isAlert}
            >
              {state.confirmText}
            </button>
          </div>
        </div>
        <img
          src="/assets/images/Chico_notificaciones.png"
          alt=""
          className="confirm-dialog-mascot"
          draggable={false}
        />
      </div>
    </div>
  );
};
