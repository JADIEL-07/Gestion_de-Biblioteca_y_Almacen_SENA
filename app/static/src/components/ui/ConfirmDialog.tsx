import React, { useEffect, useState } from 'react';
import { FiAlertTriangle, FiHelpCircle } from 'react-icons/fi';
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

interface InternalState extends Required<Pick<ConfirmOptions, 'message' | 'confirmText' | 'cancelText' | 'danger'>> {
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
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || 'Aceptar',
      cancelText: options.cancelText || 'Cancelar',
      danger: !!options.danger,
      resolve,
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

  const close = (result: boolean) => {
    state.resolve(result);
    setState(null);
  };

  return (
    <div className="confirm-dialog-overlay" onClick={() => close(false)}>
      <div className="confirm-dialog-wrap" onClick={(e) => e.stopPropagation()}>
        <div className={`confirm-dialog-card ${state.danger ? 'danger' : ''}`}>
          <div className="confirm-dialog-icon">
            {state.danger ? <FiAlertTriangle /> : <FiHelpCircle />}
          </div>
          {state.title && <h3>{state.title}</h3>}
          <p>{state.message}</p>
          <div className="confirm-dialog-actions">
            <button className="confirm-dialog-btn cancel" onClick={() => close(false)} autoFocus>
              {state.cancelText}
            </button>
            <button
              className={`confirm-dialog-btn confirm ${state.danger ? 'danger' : ''}`}
              onClick={() => close(true)}
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
