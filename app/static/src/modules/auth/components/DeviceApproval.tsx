import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FiAlertCircle, FiCheckCircle, FiMonitor, FiMapPin, FiWifi } from 'react-icons/fi';
import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';
import { DashboardBg } from '../../dashboard/components/DashboardBg';
import { getDeviceId } from '../../../shared/device';

interface DeviceInfo {
  label?: string;
  location?: string | null;
  ip?: string | null;
}

/**
 * Vista TERMINAL para el botón "Iniciar sesión" del correo de dispositivo nuevo.
 * - Autoriza el dispositivo (una vez) y muestra el resultado.
 * - No tiene botones de navegación ni redirección: es una hoja muerta.
 * - Como no añade entradas al historial, al pulsar "atrás" el navegador
 *   embebido de Gmail (Custom Tab) se cierra y vuelve a Gmail.
 * - El inicio de sesión real ocurre en el dispositivo que lo pidió (por sondeo).
 */
export const DeviceApproval: React.FC = () => {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Estamos validando el enlace…');
  const [device, setDevice] = useState<DeviceInfo | null>(null);

  useEffect(() => {
    const token = params.get('token');
    // Quitar el token de la URL (sin añadir entradas al historial).
    if (token) window.history.replaceState({}, '', '/aprobar-dispositivo');

    if (!token) {
      setStatus('error');
      setMessage('El enlace no es válido o ya se usó.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/v1/auth/approve-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, device_id: getDeviceId() }),
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'El enlace ya se usó o venció. Vuelve a iniciar sesión.');
          return;
        }

        setDevice(data.device || null);
        setStatus('ok');
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('No pudimos conectar con el servidor. Inténtalo de nuevo.');
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Éxito: dispositivo autorizado, con detalle ───
  if (status === 'ok') {
    const row = (icon: React.ReactNode, label: string, value: string) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderTop: '1px solid rgba(148,163,184,0.18)' }}>
        <span style={{ color: 'var(--sena-green, #39A900)', display: 'flex' }}>{icon}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)', minWidth: '86px' }}>{label}</span>
        <span style={{ fontSize: '0.9rem', fontWeight: 600, wordBreak: 'break-word' }}>{value}</span>
      </div>
    );

    return (
      <div className="login-wrapper">
        <HeroBackground variant="panel" alt="Biblioteca SENA" />
        <FloatingParticles />
        <DashboardBg />
        <div className="login-form-centered">
          <div className="clean-form" style={{ textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
              <span style={{
                width: 84, height: 84, borderRadius: '50%', overflow: 'hidden', display: 'block',
                boxShadow: '0 8px 24px rgba(57,169,0,0.28)',
              }}>
                <img src="/assets/images/icono-sena.png" alt="SENA"
                  style={{ width: '114%', height: '114%', margin: '-7%', display: 'block', objectFit: 'cover' }} />
              </span>
            </div>

            <div className="form-header">
              <h3 className="login-title" style={{ color: 'var(--sena-green, #39A900)' }}>
                <FiCheckCircle style={{ verticalAlign: '-2px', marginRight: 6 }} />
                Inicio de sesión aprobado
              </h3>
              <p>Autorizaste el acceso desde este dispositivo:</p>
            </div>

            <div style={{ textAlign: 'left', margin: '0.5rem 0 1.25rem' }}>
              {row(<FiMonitor size={18} />, 'Dispositivo', device?.label || 'Dispositivo desconocido')}
              {row(<FiMapPin size={18} />, 'Ubicación', device?.location || 'No disponible')}
              {device?.ip ? row(<FiWifi size={18} />, 'IP', device.ip) : null}
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', margin: 0 }}>
              Ya puedes volver a tu otro dispositivo y continuar. Puedes cerrar esta pestaña.
            </p>
            <div style={{ height: '10px' }} />
          </div>
        </div>
      </div>
    );
  }

  // ─── Cargando / error ───
  return (
    <div className="login-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />
      <FloatingParticles />
      <DashboardBg />
      <div className="login-form-centered">
        <div className="clean-form">
          <div className="sena-logo">
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg"
              alt="Logo SENA"
              className="sena-logo-img"
            />
          </div>

          <div className="form-header">
            <h3 className="login-title">
              {status === 'error' ? 'No pudimos autorizar' : 'Autorizando dispositivo…'}
            </h3>
            <p>
              {status === 'error'
                ? message
                : 'Un momento, estamos validando el enlace de tu correo.'}
            </p>
          </div>

          {status === 'error' && (
            <>
              <div className="alert-error fade-in"><FiAlertCircle /> {message}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', marginTop: 8 }}>
                Puedes cerrar esta pestaña y volver a intentar el inicio de sesión desde tu dispositivo.
              </p>
            </>
          )}

          <div style={{ height: '20px' }} />
        </div>
      </div>
    </div>
  );
};
