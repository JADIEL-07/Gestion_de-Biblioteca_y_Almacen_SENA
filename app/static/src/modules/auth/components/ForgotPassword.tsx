import { useState } from 'react';
import { FiMail, FiArrowLeft, FiAlertCircle, FiCheckCircle } from 'react-icons/fi';
import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';

export const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!email.trim()) {
      setError('Por favor ingresa tu correo institucional');
      return;
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('Formato de correo inválido (ej: usuario@correo.com)');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'Error al procesar solicitud');

      setMessage(data.message || 'Si la cuenta existe, recibirás una contraseña temporal en breve.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />
      <FloatingParticles />
      
      <div className="login-form-centered">
        <div className="clean-form">
          <div className="sena-logo">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg" alt="Logo SENA" className="sena-logo-img" />
          </div>
          
          <div className="form-header">
            <h3 className="login-title">Recuperar Contraseña</h3>
            <p>Ingresa tu correo institucional. Te enviaremos una <strong>contraseña temporal</strong> para que ingreses, y al entrar el sistema te pedirá una nueva.</p>
          </div>

          {error && <div className="alert-error fade-in"><FiAlertCircle /> {error}</div>}
          {message && <div className="alert-success fade-in"><FiCheckCircle /> {message}</div>}

          <form onSubmit={handleSubmit} noValidate>
            <div className={`input-group ${error ? 'has-error' : ''}`}>
              <label className="input-label">Correo Institucional</label>
              <div className="input-field-wrapper">
                <FiMail className="input-icon" />
                <input
                  type="email"
                  className="clean-input"
                  spellCheck={false}
                  placeholder="usuario@mi.sena.edu.co"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>

            <button type="submit" className="submit-btn" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar contraseña temporal'}
            </button>
          </form>

          <button className="back-btn" onClick={() => window.history.back()} disabled={loading}>
            <FiArrowLeft /> Volver al inicio de sesión
          </button>
        </div>
      </div>
    </div>
  );
};
