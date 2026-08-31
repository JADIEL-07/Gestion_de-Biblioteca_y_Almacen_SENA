import { useState, useEffect } from 'react';
import { FiLock, FiEye, FiEyeOff, FiAlertCircle, FiCheckCircle, FiShield } from 'react-icons/fi';
import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';

interface Props {
  onDone: (user: any) => void;
  onLogout: () => void;
}

/**
 * Pantalla bloqueante que aparece cuando el usuario inicia sesión con
 * `must_change_password=true` (recuperación con contraseña temporal).
 * No deja avanzar hasta que cambie la contraseña por una nueva.
 */
export const ForcePasswordChange: React.FC<Props> = ({ onDone, onLogout }) => {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return document.body.classList.contains('theme-light') ? 'light' : 'dark';
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isLight = document.body.classList.contains('theme-light');
      setTheme(isLight ? 'light' : 'dark');
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const currentBg = theme === 'light'
    ? '/assets/images/Fondo blanco.webp'
    : '/assets/images/Fondo negro.webp';

  const [newP, setNewP] = useState('');
  const [confP, setConfP] = useState('');
  const [showP, setShowP] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const strength = (() => {
    let s = 0;
    if (newP.length >= 8) s++;
    if (/[A-Z]/.test(newP)) s++;
    if (/[0-9]/.test(newP)) s++;
    if (/[^A-Za-z0-9]/.test(newP)) s++;
    return s;
  })();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newP.length < 8 || /\s/.test(newP)) {
      setError('La contraseña debe tener mínimo 8 caracteres y sin espacios.');
      return;
    }
    if (newP !== confP) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (strength < 3) {
      setError('La contraseña debe ser al menos "Buena" (mayúscula + número).');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/v1/auth/force-change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ new_password: newP }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña.');

      setSuccess('¡Listo! Continuando...');
      // Actualizar el usuario almacenado quitando el flag
      const storedUser = localStorage.getItem('user');
      const user = storedUser ? JSON.parse(storedUser) : {};
      user.must_change_password = false;
      localStorage.setItem('user', JSON.stringify(user));
      localStorage.removeItem('force_password_change');

      setTimeout(() => onDone(user), 800);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="background-image-container">
        <img src={currentBg} alt="Biblioteca SENA" />
        <div className="bg-overlay"></div>
      </div>
      <FloatingParticles />

      <div className="login-form-centered">
        <div className="clean-form">
          <div className="sena-logo">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg" alt="Logo SENA" className="sena-logo-img" />
          </div>

          <div className="form-header">
            <h3 className="login-title"><FiShield style={{ verticalAlign: 'middle', marginRight: 6 }} />Cambio de contraseña requerido</h3>
            <p>Iniciaste con una contraseña temporal. Por seguridad, define una nueva para continuar.</p>
          </div>

          {error && <div className="alert-error fade-in"><FiAlertCircle /> {error}</div>}
          {success && <div className="alert-success fade-in"><FiCheckCircle /> {success}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className="input-group">
              <label className="input-label">Nueva contraseña</label>
              <div className="input-field-wrapper">
                <FiLock className="input-icon" />
                <input
                  type={showP ? 'text' : 'password'}
                  className="clean-input password-input"
                  placeholder="Mínimo 8 caracteres"
                  value={newP}
                  onChange={(e) => setNewP(e.target.value)}
                  disabled={loading}
                />
                <button type="button" className="password-toggle" onClick={() => setShowP(!showP)}>
                  {showP ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              {newP && (
                <div style={{ marginTop: 6, fontSize: '0.78em', color: strength >= 3 ? '#22c55e' : '#f59e0b' }}>
                  Fortaleza: {['Muy débil', 'Débil', 'Regular', 'Buena', 'Fuerte'][strength]}
                </div>
              )}
            </div>

            <div className="input-group">
              <label className="input-label">Confirmar nueva contraseña</label>
              <div className="input-field-wrapper">
                <FiLock className="input-icon" />
                <input
                  type={showP ? 'text' : 'password'}
                  className="clean-input"
                  placeholder="Repite la contraseña"
                  value={confP}
                  onChange={(e) => setConfP(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <button type="submit" className="submit-btn" disabled={loading || !newP || !confP}>
              {loading ? 'Guardando...' : 'Cambiar y continuar'}
            </button>
          </form>

          <button className="back-btn" onClick={onLogout} disabled={loading}>
            Cerrar sesión
          </button>
          <div style={{ height: '20px' }}></div>
        </div>
      </div>
    </div>
  );
};
