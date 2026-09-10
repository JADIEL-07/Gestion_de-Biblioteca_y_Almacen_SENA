import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';
import { DashboardBg } from '../../dashboard/components/DashboardBg';

interface DeviceVerifiedProps {
  message?: string;
}

/** Pantalla puente tras autorizar el dispositivo: logo SENA girando + mensaje.
 *  Se muestra 2 s antes de entrar al panel. */
export const DeviceVerified: React.FC<DeviceVerifiedProps> = ({ message }) => (
  <div className="login-wrapper">
    <HeroBackground variant="panel" alt="Biblioteca SENA" />
    <FloatingParticles />
    <DashboardBg />
    <div className="login-form-centered">
      <div className="clean-form device-verified-card">
        <span className="device-verified-spinner" aria-hidden="true">
          <span className="device-verified-logo">
            <img src="/assets/images/icono-sena.png" alt="" />
          </span>
        </span>
        <h3 className="login-title">Dispositivo verificado</h3>
        <p>{message || 'Se ha verificado exitosamente el dispositivo. Entrando…'}</p>
      </div>
    </div>
  </div>
);
