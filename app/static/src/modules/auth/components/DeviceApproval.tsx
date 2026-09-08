import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';
import { DashboardBg } from '../../dashboard/components/DashboardBg';
import { getDeviceId } from '../../../shared/device';

interface DeviceApprovalProps {
  onApproved?: (user: any) => void;
}

export const DeviceApproval: React.FC<DeviceApprovalProps> = ({ onApproved }) => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('Estamos validando el enlace…');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('El enlace no es válido.');
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
        const data = await res.json();
        if (cancelled) return;

        if (!res.ok) {
          setStatus('error');
          setMessage(data.error || 'No pudimos autorizar el dispositivo.');
          return;
        }

        localStorage.setItem('token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.must_change_password) localStorage.setItem('force_password_change', '1');

        setStatus('ok');
        setMessage('Sesión iniciada con éxito.');
        // Quitar el token de la URL / historial
        window.history.replaceState({}, '', '/aprobar-dispositivo');

        setTimeout(() => {
          if (cancelled) return;
          if (onApproved) onApproved(data.user);
          else navigate('/', { replace: true });
        }, 1800);
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
              {status === 'ok'
                ? '¡Sesión iniciada con éxito!'
                : status === 'error'
                  ? 'No pudimos autorizar'
                  : 'Autorizando dispositivo…'}
            </h3>
            <p>
              {status === 'ok'
                ? 'Este dispositivo quedó autorizado. Te estamos redirigiendo…'
                : status === 'error'
                  ? message
                  : 'Un momento, estamos validando el enlace de tu correo.'}
            </p>
          </div>

          {status === 'ok' && (
            <div className="alert-success fade-in"><FiCheckCircle /> {message}</div>
          )}

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
