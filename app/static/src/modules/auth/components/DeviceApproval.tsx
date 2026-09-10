import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
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

interface DeviceApprovalProps {
  onApproved?: (user: any) => void;
}

export const DeviceApproval: React.FC<DeviceApprovalProps> = ({ onApproved }) => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Estamos validando el enlace…');
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [approvedUser, setApprovedUser] = useState<any>(null);

  const goToPanel = () => {
    if (onApproved && approvedUser) onApproved(approvedUser);
    else navigate('/', { replace: true });
  };

  useEffect(() => {
    const token = params.get('token');
    // Sin token (p. ej. se volvió atrás a esta URL): no dejar la vista colgada.
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    let redirectTimer: number | undefined;

    // Quitar el token de la barra de direcciones cuanto antes (no queda en el historial).
    window.history.replaceState({}, '', '/aprobar-dispositivo');

    (async () => {
      try {
        const res = await fetch('/api/v1/auth/approve-device', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, device_id: getDeviceId() }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'No pudimos autorizar el dispositivo.');
          // Un enlace ya usado / vencido no debe dejar al usuario varado:
          // lo llevamos al login (si el dispositivo ya quedó de confianza, entrará directo).
          redirectTimer = window.setTimeout(() => {
            if (!cancelled) navigate('/login', { replace: true });
          }, 4000);
          return;
        }

        localStorage.setItem('token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.must_change_password) localStorage.setItem('force_password_change', '1');

        setDevice(data.device || null);
        setApprovedUser(data.user);
        setStatus('ok');

        // Redirección automática tras 8 s (da tiempo a leer la ubicación).
        redirectTimer = window.setTimeout(() => {
          if (cancelled) return;
          if (onApproved) onApproved(data.user);
          else navigate('/', { replace: true });
        }, 8000);
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('No pudimos conectar con el servidor. Inténtalo de nuevo.');
          redirectTimer = window.setTimeout(() => {
            if (!cancelled) navigate('/login', { replace: true });
          }, 4000);
        }
      }
    })();

    return () => { cancelled = true; if (redirectTimer) window.clearTimeout(redirectTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Éxito: inicio de sesión aprobado, con el dispositivo y la ubicación ───
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

            <button type="button" className="submit-btn" onClick={goToPanel}>
              Continuar al panel
            </button>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)', marginTop: 10 }}>
              Te llevaremos automáticamente en unos segundos…
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
              <button
                type="button"
                className="submit-btn"
                onClick={() => navigate('/login', { replace: true })}
              >
                Volver a iniciar sesión
              </button>
            </>
          )}

          <div style={{ height: '20px' }} />
        </div>
      </div>
    </div>
  );
};
