import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiMail, FiLock, FiUser, FiEye, FiEyeOff, FiAlertCircle, FiPhone, FiCreditCard, FiShield, FiSmartphone } from 'react-icons/fi';
import './LoginForm.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';
import { QRCodeCanvas } from 'qrcode.react';
import { DashboardBg } from '../../dashboard/components/DashboardBg';
import { DeviceVerified } from './DeviceVerified';
import { getDeviceId, hasAcceptedTos, markTosAccepted } from '../../../shared/device';

interface LoginFormProps {
  mode: 'login' | 'register';
  onForgotPassword?: () => void;
  onLoginSuccess?: (user: any) => void;
  onSwitchMode?: (mode: 'login' | 'register') => void;
}

// ── Regex compartidas con backend ─────────────────────────────────────
const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const PHONE_CO_RE = /^3\d{9}$/;

export const LoginForm: React.FC<LoginFormProps> = ({ mode, onLoginSuccess }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Si venimos del botón "Ir a la plataforma" del correo, traemos un token para
  // precargar los datos del registro pendiente y saltar directo al paso del código.
  const [prefilling, setPrefilling] = useState<boolean>(!!searchParams.get('verify'));
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [documentType, setDocumentType] = useState('CC');
  const [documentNumber, setDocumentNumber] = useState('');

  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [errors, setErrors] = useState({ nombre: '', email: '', phone: '', password: '', documentNumber: '', terms: '' });

  // ── Estados para verificación de cuenta post-registro ────────────
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyLoading, setVerifyLoading] = useState(false);

  // ── Estados para 2FA ──────────────────────────────────────────────
  const [requires2fa, setRequires2fa] = useState(false);
  const [tempToken2fa, setTempToken2fa] = useState('');
  const [totpData, setTotpData] = useState<{ totp_secret: string, otpauth_url: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [twoFaEmailHint, setTwoFaEmailHint] = useState<string | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // ── Autorización de dispositivo nuevo (correo con enlace de 15 min) ──
  const [deviceApprovalHint, setDeviceApprovalHint] = useState<string | null>(null);
  const [awaitingDeviceApproval, setAwaitingDeviceApproval] = useState(false);
  const [deviceApprovalPoll, setDeviceApprovalPoll] = useState<string | null>(null);
  const [deviceVerifiedSplash, setDeviceVerifiedSplash] = useState(false);

  // ── T&C en el login: una sola vez por dispositivo ──
  const [needLoginTos] = useState(() => mode === 'login' && !hasAcceptedTos());
  const [loginTosChecked, setLoginTosChecked] = useState(false);

  const isRegister = mode === 'register';

  // ── Llegada desde el correo: precargar datos + ir al paso del código ──
  useEffect(() => {
    const verifyToken = searchParams.get('verify');
    if (!verifyToken) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(
          `/api/v1/auth/pending-registration?token=${encodeURIComponent(verifyToken)}`
        );
        const data = await res.json();
        if (cancelled) return;

        if (data.found) {
          // Datos traídos del servidor: funcionan en cualquier dispositivo.
          setNombre(data.name || '');
          setEmail(data.email || '');
          setPhone(data.phone || '');
          setDocumentType(data.document_type || 'CC');
          setDocumentNumber(data.document_number || '');
          setAcceptedTerms(true);
          // Autocompleta el campo del código si el enlace lo trae y sigue vigente.
          if (typeof data.code === 'string' && /^\d{6}$/.test(data.code)) {
            setVerifyCode(data.code);
          }
          // Salta directo a la pantalla de ingresar el código.
          setPendingVerifyEmail(data.email);
        } else if (data.reason === 'already_verified') {
          setSuccessMsg('Tu cuenta ya está verificada. Inicia sesión.');
          if (data.email) setEmail(data.email);
        } else {
          setServerError('El enlace expiró o ya no está disponible. Vuelve a registrarte si lo necesitas.');
          if (data.email) setEmail(data.email);
        }
      } catch {
        if (!cancelled) setServerError('No pudimos cargar tus datos de registro. Inténtalo de nuevo.');
      } finally {
        if (!cancelled) {
          setPrefilling(false);
          // Quitar el token de la URL (no dejarlo en el historial ni re-consultarlo al refrescar).
          window.history.replaceState({}, '', '/register');
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dispositivo nuevo: el dispositivo ORIGINAL sondea si ya se autorizó ──
  useEffect(() => {
    if (!awaitingDeviceApproval || !deviceApprovalPoll) return;
    let stopped = false;

    const finishLogin = (data: any) => {
      localStorage.setItem('token', data.access_token);
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.must_change_password) localStorage.setItem('force_password_change', '1');
      // Pantalla puente con el logo girando (~2 s) antes de entrar al panel.
      setDeviceVerifiedSplash(true);
      window.setTimeout(() => { if (onLoginSuccess) onLoginSuccess(data.user); }, 2200);
    };

    const tick = async () => {
      try {
        const res = await fetch('/api/v1/auth/device-approval-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poll_token: deviceApprovalPoll }),
        });
        const data = await res.json();
        if (stopped) return;
        if (data.status === 'approved' && data.access_token) {
          stopped = true;
          window.clearInterval(id);
          finishLogin(data);
        } else if (data.status === 'expired' || data.status === 'invalid') {
          stopped = true;
          window.clearInterval(id);
          setServerError('El enlace de autorización expiró. Vuelve a iniciar sesión.');
        }
      } catch {
        /* reintenta en el próximo tick */
      }
    };

    const id = window.setInterval(tick, 3000);
    tick();
    // Deja de sondear a los ~10 min
    const timeoutId = window.setTimeout(() => { stopped = true; window.clearInterval(id); }, 10 * 60 * 1000);

    return () => { stopped = true; window.clearInterval(id); window.clearTimeout(timeoutId); };
  }, [awaitingDeviceApproval, deviceApprovalPoll, onLoginSuccess]);

  // ── Validación ────────────────────────────────────────────────────

  const validateFields = () => {
    let currentErrors = { nombre: '', email: '', phone: '', password: '', documentNumber: '', terms: '' };
    let hasError = false;

    if (isRegister) {
      if (!nombre.trim()) {
        currentErrors.nombre = 'Este campo es requerido';
        hasError = true;
      }
      if (!email.trim()) {
        currentErrors.email = 'Este campo es requerido';
        hasError = true;
      } else if (!EMAIL_RE.test(email.trim())) {
        currentErrors.email = 'Formato de correo inválido (ej: usuario@correo.com)';
        hasError = true;
      }
      if (!documentNumber.trim()) {
        currentErrors.documentNumber = 'El número de documento es requerido';
        hasError = true;
      } else if (!/^\d{6,12}$/.test(documentNumber.trim())) {
        currentErrors.documentNumber = 'El documento debe tener entre 6 y 12 dígitos';
        hasError = true;
      }
      // Teléfono: opcional pero si se envía debe ser válido
      if (phone.trim()) {
        const cleaned = phone.replace(/[\s\-+]/g, '').replace(/^57/, '');
        if (!PHONE_CO_RE.test(cleaned)) {
          currentErrors.phone = 'Teléfono inválido. 10 dígitos comenzando en 3 (ej: 3001234567)';
          hasError = true;
        }
      }
      if (!acceptedTerms) {
        currentErrors.terms = 'Debes aceptar los Términos y Condiciones para crear la cuenta';
        hasError = true;
      }
    } else {
      if (!nombre.trim()) {
        currentErrors.nombre = 'El número de documento es requerido';
        hasError = true;
      }
      if (needLoginTos && !loginTosChecked) {
        currentErrors.terms = 'Debes aceptar los Términos y Condiciones para continuar';
        hasError = true;
      }
    }

    // Validación de Contraseña
    const restrictedChars = /[_.,:;'+-]/;
    if (!password) {
      currentErrors.password = 'La contraseña es requerida';
      hasError = true;
    } else if (password.length < 8) {
      currentErrors.password = 'Mínimo 8 caracteres';
      hasError = true;
    } else if (/\s/.test(password)) {
      currentErrors.password = 'No se permiten espacios';
      hasError = true;
    } else if (isRegister && restrictedChars.test(password)) {
      currentErrors.password = 'Sin caracteres especiales (_-.,:;\'+)';
      hasError = true;
    }

    setErrors(currentErrors);
    return !hasError;
  };

  // ── Submit principal (login o registro) ──────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    setSuccessMsg('');

    if (!validateFields()) return;

    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/v1/auth/register' : '/api/v1/auth/login';
      const payload = isRegister
        ? {
            name: nombre,
            email: email.trim().toLowerCase(),
            password,
            phone: phone.trim(),
            document_type: documentType,
            document_number: documentNumber.trim(),
          }
        : {
            nombre,
            password,
            device_id: getDeviceId(),
            ...(needLoginTos ? { accepted_tos: true } : {}),
          };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      // ─── Caso: cuenta no verificada (login) ─────────────────────
      if (!response.ok && data.requires_verification) {
        setPendingVerifyEmail(data.email || email.trim().toLowerCase());
        setServerError('');
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Error en la operación');
      }

      // Credenciales aceptadas por el servidor: no volver a pedir T&C en este dispositivo.
      if (!isRegister && needLoginTos) markTosAccepted();

      if (isRegister) {
        // Requiere verificación con código
        if (data.requires_verification) {
          setPendingVerifyEmail(data.email);
          setSuccessMsg('');
          return;
        }
        setSuccessMsg('¡Registro exitoso! Ya puedes iniciar sesión.');
        setNombre(''); setEmail(''); setPhone(''); setPassword(''); setAcceptedTerms(false);
      } else {
        if (data.requires_device_approval) {
          setAwaitingDeviceApproval(true);
          setDeviceApprovalHint(data.email_hint || null);
          setDeviceApprovalPoll(data.poll_token || null);
          setSuccessMsg('');
          return;
        }

        if (data.requires_2fa) {
          setRequires2fa(true);
          setTempToken2fa(data.temp_token);
          setTwoFaEmailHint(data.email_hint || null);
          setEmailSent(false);
          setSuccessMsg('Credenciales correctas. Ingresa tu código de verificación.');
          return;
        }

        localStorage.setItem('token', data.access_token);
        if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
        localStorage.setItem('user', JSON.stringify(data.user));
        // Si debe cambiar contraseña tras login (recuperación temporal), redirigir
        if (data.must_change_password) {
          localStorage.setItem('force_password_change', '1');
        }
        if (onLoginSuccess) onLoginSuccess(data.user);
      }
    } catch (err: any) {
      setServerError(err.message);
      setTimeout(() => setServerError(''), 4000);
    } finally {
      setLoading(false);
    }
  };

  // ── Verificar código ─────────────────────────────────────────────

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (verifyCode.length !== 6) {
      setServerError('El código debe tener 6 dígitos.');
      return;
    }
    setVerifyLoading(true);
    try {
      const res = await fetch('/api/v1/auth/verify-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingVerifyEmail, code: verifyCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código inválido');

      if (data.otpauth_url) {
        setTotpData({ totp_secret: data.totp_secret, otpauth_url: data.otpauth_url });
        localStorage.setItem('temp_token', data.access_token);
        localStorage.setItem('temp_user', JSON.stringify(data.user));
        setSuccessMsg('¡Cuenta verificada! Configura tu autenticador.');
        setPendingVerifyEmail(null);
        return;
      }

      // Verificación exitosa fallback
      localStorage.setItem('token', data.access_token);
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setSuccessMsg('¡Cuenta verificada! Redirigiendo...');
      setTimeout(() => {
        if (onLoginSuccess) onLoginSuccess(data.user);
      }, 800);
    } catch (err: any) {
      setServerError(err.message);
      setTimeout(() => setServerError(''), 4000);
    } finally {
      setVerifyLoading(false);
    }
  };

  const handleVerify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError('');
    if (twoFaCode.length !== 6) {
      setServerError('El código debe tener 6 dígitos.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/v1/auth/verify-2fa', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken2fa}`
        },
        body: JSON.stringify({ code: twoFaCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Código incorrecto');

      localStorage.setItem('token', data.access_token);
      if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token);
      localStorage.setItem('user', JSON.stringify(data.user));
      if (data.must_change_password) {
        localStorage.setItem('force_password_change', '1');
      }
      setSuccessMsg('¡Autenticado con éxito!');
      setTimeout(() => {
        if (onLoginSuccess) onLoginSuccess(data.user);
      }, 800);
    } catch (err: any) {
      setServerError(err.message);
      setTimeout(() => setServerError(''), 4000);
    } finally {
      setLoading(false);
    }
  };

  // ── Enviar código 2FA al correo ─────────────────────────────────
  const sendEmailCode = async () => {
    setServerError('');
    setEmailSending(true);
    try {
      const res = await fetch('/api/v1/auth/2fa/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${tempToken2fa}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el correo.');
      setEmailSent(true);
      setSuccessMsg(data.message || 'Código enviado a tu correo.');
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch (err: any) {
      setServerError(err.message);
      setTimeout(() => setServerError(''), 4000);
    } finally {
      setEmailSending(false);
    }
  };

  const finishRegistration = () => {
    const token = localStorage.getItem('temp_token');
    const userStr = localStorage.getItem('temp_user');
    if (token && userStr) {
      localStorage.setItem('token', token);
      localStorage.setItem('user', userStr);
      localStorage.removeItem('temp_token');
      localStorage.removeItem('temp_user');
      if (onLoginSuccess) onLoginSuccess(JSON.parse(userStr));
    }
  };

  const resendCode = async () => {
    if (!pendingVerifyEmail) return;
    setServerError('');
    try {
      const res = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pendingVerifyEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setServerError(data.error || data.message || 'No se pudo reenviar el código.');
        setTimeout(() => setServerError(''), 4000);
        return;
      }
      setSuccessMsg(data.message || 'Código reenviado.');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch {
      setServerError('No se pudo reenviar el código.');
    }
  };

  // ──────────────────────────────────────────────────────────────────
  //  Render
  // ──────────────────────────────────────────────────────────────────

  // ─── Dispositivo verificado: logo SENA girando antes de entrar ──
  if (deviceVerifiedSplash) {
    return <DeviceVerified message="Se ha verificado exitosamente el dispositivo. Entrando…" />;
  }

  // ─── Cargando datos del registro (llegada desde el correo) ──────
  if (prefilling) {
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
              <h3 className="login-title">Cargando tu registro…</h3>
              <p>Un momento, estamos recuperando tus datos.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Dispositivo nuevo: revisa tu correo para autorizar ─────────
  if (awaitingDeviceApproval) {
    return (
      <div className="login-wrapper">
        <HeroBackground variant="panel" alt="Biblioteca SENA" />
        <FloatingParticles />
        <DashboardBg />
        <div className="login-form-centered">
          <div className="clean-form">
            <div className="sena-logo">
              <img src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg" alt="Logo SENA" className="sena-logo-img" />
            </div>
            <div className="form-header">
              <h3 className="login-title">Autoriza este dispositivo</h3>
              <p>
                Detectamos un inicio de sesión desde un dispositivo nuevo. Te enviamos un correo
                {deviceApprovalHint ? <> a <strong>{deviceApprovalHint}</strong></> : null}.
              </p>
            </div>

            {serverError && <div className="alert-error fade-in"><FiAlertCircle /> {serverError}</div>}
            {successMsg && <div className="alert-success fade-in">{successMsg}</div>}

            <div className="alert-success fade-in" style={{ textAlign: 'left' }}>
              Abre el correo y pulsa <strong>“Iniciar sesión”</strong>. En cuanto lo hagas,
              <strong> esta pantalla entrará sola</strong> — no necesitas volver aquí. El enlace vence
              en <strong>15 minutos</strong>.
            </div>

            <div style={{ textAlign: 'center', fontSize: '0.85em', color: 'var(--text-muted, #64748b)', margin: '4px 0 8px' }}>
              Esperando tu confirmación…
            </div>

            <button
              className="back-btn"
              onClick={() => { setAwaitingDeviceApproval(false); setDeviceApprovalHint(null); setDeviceApprovalPoll(null); }}
            >
              Volver a iniciar sesión
            </button>
            <div style={{ height: '20px' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pantalla de verificación con código ────────────────────────
  if (pendingVerifyEmail) {
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
              <h3 className="login-title">Verifica tu correo</h3>
              <p>Ingresa el código de 6 dígitos que enviamos a <strong>{pendingVerifyEmail}</strong></p>
            </div>

            {serverError && <div className="alert-error fade-in"><FiAlertCircle /> {serverError}</div>}
            {successMsg && <div className="alert-success fade-in">{successMsg}</div>}

            <form onSubmit={handleVerifyCode} noValidate>
              <div className="input-group">
                <label className="input-label">Código de verificación</label>
                <div className="input-field-wrapper">
                  <FiShield className="input-icon" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="clean-input"
                    spellCheck={false}
                    placeholder="••••••"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                    disabled={verifyLoading}
                    style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: '1.2em' }}
                  />
                </div>
              </div>

              <button type="submit" className="submit-btn" disabled={verifyLoading || verifyCode.length !== 6}>
                {verifyLoading ? 'Verificando...' : 'Confirmar y entrar'}
              </button>
            </form>

            <div className="auth-footer">
              <p style={{ fontSize: '0.85em' }}>
                ¿No te llegó el código?{' '}
                <button type="button" className="switch-mode-btn" onClick={resendCode}>
                  Reenviar
                </button>
              </p>
            </div>

            <button className="back-btn" onClick={() => { setPendingVerifyEmail(null); setVerifyCode(''); }}>
              Cambiar de cuenta
            </button>
            <div style={{ height: '20px' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pantalla de configuración de 2FA (tras registro exitoso) ────
  if (totpData) {
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
              <h3 className="login-title">Configura tu Autenticador</h3>
              <p>Escanea el código QR con Google Authenticator o similar para configurar la verificación de dos pasos.</p>
            </div>

            {successMsg && <div className="alert-success fade-in">{successMsg}</div>}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '20px 0' }}>
              <div style={{ padding: '16px', background: '#fff', borderRadius: '8px', marginBottom: '16px' }}>
                <QRCodeCanvas value={totpData.otpauth_url} size={200} level="M" />
              </div>
              <p style={{ fontSize: '0.9em', color: '#666', textAlign: 'center' }}>
                O ingresa el código manual:<br/>
                <strong style={{ letterSpacing: '2px', fontSize: '1.1em', userSelect: 'all' }}>{totpData.totp_secret}</strong>
              </p>
            </div>

            <button type="button" className="submit-btn" onClick={finishRegistration}>
              He escaneado el código (Entrar)
            </button>
            <div style={{ height: '20px' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pantalla de ingreso 2FA (login) ─────────────────────────────
  if (requires2fa) {
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
              <h3 className="login-title">Verificación 2FA</h3>
              <p>Ingresa el código de 6 dígitos de tu app de autenticación o el que te enviemos al correo.</p>
            </div>

            {serverError && <div className="alert-error fade-in"><FiAlertCircle /> {serverError}</div>}
            {successMsg && <div className="alert-success fade-in">{successMsg}</div>}

            <form onSubmit={handleVerify2fa} noValidate>
              <div className="input-group">
                <label className="input-label">Código de verificación</label>
                <div className="input-field-wrapper">
                  <FiSmartphone className="input-icon" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    className="clean-input"
                    spellCheck={false}
                    placeholder="000000"
                    value={twoFaCode}
                    onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, ''))}
                    disabled={loading}
                    style={{ letterSpacing: '0.5em', textAlign: 'center', fontSize: '1.2em' }}
                  />
                </div>
              </div>

              <button type="submit" className="submit-btn" disabled={loading || twoFaCode.length !== 6}>
                {loading ? 'Verificando...' : 'Autenticar'}
              </button>
            </form>

            <div className="auth-footer">
              <p style={{ fontSize: '0.85em' }}>
                ¿No usas una app de autenticación?{' '}
                <button type="button" className="switch-mode-btn" onClick={sendEmailCode} disabled={emailSending}>
                  {emailSending
                    ? 'Enviando…'
                    : emailSent
                      ? 'Reenviar código al correo'
                      : `Enviar código${twoFaEmailHint ? ` a ${twoFaEmailHint}` : ' al correo'}`}
                </button>
              </p>
            </div>

            <button className="back-btn" onClick={() => { setRequires2fa(false); setTempToken2fa(''); setEmailSent(false); }}>
              Volver atrás
            </button>
            <div style={{ height: '20px' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Pantalla normal (login/register) ───────────────────────────
  return (
    <div className="login-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />

      <FloatingParticles />
      <DashboardBg />
      <div className="login-form-centered">
        <div className={`clean-form ${isRegister ? 'register-mode' : ''}`}>
          <div className="sena-logo">
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg"
              alt="Logo SENA"
              className="sena-logo-img"
            />
          </div>

          <div className="form-header">
            <h3 className="login-title">{isRegister ? 'Crear Cuenta' : 'Iniciar Sesión'}</h3>
            <p>{isRegister ? 'Completa tus datos de registro' : 'Ingresa tus credenciales de acceso'}</p>
          </div>

          {serverError && <div className="alert-error fade-in"><FiAlertCircle /> {serverError}</div>}
          {successMsg && <div className="alert-success fade-in">{successMsg}</div>}

          <form onSubmit={handleSubmit} noValidate>

            {/* Identificador */}
            <div className={`input-group ${errors.nombre ? 'has-error' : ''}`}>
              <label className="input-label">
                {isRegister ? 'Nombre Completo' : 'Número de Documento'}
              </label>
              <div className="input-field-wrapper">
                <FiUser className="input-icon" />
                <input
                  type="text"
                  className="clean-input"
                  spellCheck={false}
                  placeholder={isRegister ? 'Ej. Juan Pérez' : 'Ingresa tu documento'}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={loading}
                />
              </div>
              {errors.nombre && <span className="error-message"><FiAlertCircle/> {errors.nombre}</span>}
            </div>

            {isRegister && (
              <div className="form-row-register">
                <div className="input-group">
                  <label className="input-label">Tipo</label>
                  <select
                    className="clean-select"
                    value={documentType}
                    onChange={(e) => setDocumentType(e.target.value)}
                  >
                    <option value="CC">CC</option>
                    <option value="TI">TI</option>
                    <option value="CE">CE</option>
                    <option value="PEP">PEP</option>
                  </select>
                </div>
                <div className={`input-group ${errors.documentNumber ? 'has-error' : ''}`} style={{ flex: 2 }}>
                  <label className="input-label">Número de Documento</label>
                  <div className="input-field-wrapper">
                    <FiCreditCard className="input-icon" />
                    <input
                      type="text"
                      inputMode="numeric"
                      className="clean-input"
                      spellCheck={false}
                      placeholder="Ej. 1098..."
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value.replace(/\D/g, ''))}
                      disabled={loading}
                    />
                  </div>
                  {errors.documentNumber && <span className="error-message"><FiAlertCircle/> {errors.documentNumber}</span>}
                </div>
              </div>
            )}

            {isRegister && (
              <div className={`input-group ${errors.email ? 'has-error' : ''}`}>
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
                {errors.email && <span className="error-message"><FiAlertCircle/> {errors.email}</span>}
              </div>
            )}

            {isRegister && (
              <div className={`input-group ${errors.phone ? 'has-error' : ''}`}>
                <label className="input-label">Número de Teléfono</label>
                <div className="input-field-wrapper">
                  <FiPhone className="input-icon" />
                  <input
                    type="tel"
                    inputMode="tel"
                    maxLength={13}
                    className="clean-input"
                    spellCheck={false}
                    placeholder="Ej. 3001234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={loading}
                  />
                </div>
                {errors.phone && <span className="error-message"><FiAlertCircle/> {errors.phone}</span>}
              </div>
            )}

            <div className={`input-group ${errors.password ? 'has-error' : ''}`}>
              <label className="input-label">Contraseña</label>
              <div className="input-field-wrapper">
                <FiLock className="input-icon" />
                <input
                  type={showPassword ? "text" : "password"}
                  className="clean-input password-input"
                  spellCheck={false}
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <FiEyeOff /> : <FiEye />}
                </button>
              </div>
              {errors.password && <span className="error-message"><FiAlertCircle/> {errors.password}</span>}
            </div>

            {!isRegister && (
              <div style={{ textAlign: 'right' }}>
                <a
                  href="#"
                  className="forgot-password"
                  onClick={(e) => { e.preventDefault(); navigate('/forgot-password'); }}
                >
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
            )}

            {(isRegister || needLoginTos) && (
              <div className={`terms-check ${errors.terms ? 'has-error' : ''}`}>
                <label className="terms-check-label">
                  <input
                    type="checkbox"
                    checked={isRegister ? acceptedTerms : loginTosChecked}
                    onChange={(e) => (isRegister ? setAcceptedTerms(e.target.checked) : setLoginTosChecked(e.target.checked))}
                    disabled={loading}
                  />
                  <span>
                    He leído y acepto los{' '}
                    <a href="/terms" target="_blank" rel="noopener noreferrer">Términos y Condiciones</a>
                    {' '}y la{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer">Política de Privacidad</a>.
                  </span>
                </label>
                {errors.terms && (
                  <span className="error-message" style={{ position: 'static' }}>
                    <FiAlertCircle /> {errors.terms}
                  </span>
                )}
              </div>
            )}

            <button
              type="submit"
              className="submit-btn"
              disabled={loading || (isRegister && !acceptedTerms) || (!isRegister && needLoginTos && !loginTosChecked)}
            >
              {loading ? 'Procesando...' : (isRegister ? 'Registrarse ahora' : 'Ingresar a la Plataforma')}
            </button>
          </form>

          <div className="auth-footer">
            {isRegister ? (
              <p>
                ¿Ya tienes cuenta?{' '}
                <button
                  type="button"
                  className="switch-mode-btn"
                  onClick={() => navigate('/login')}
                  disabled={loading}
                >
                  Iniciar sesión
                </button>
              </p>
            ) : (
              <p>
                ¿No tienes cuenta?{' '}
                <button
                  type="button"
                  className="switch-mode-btn"
                  onClick={() => navigate('/register')}
                  disabled={loading}
                >
                  Regístrate aquí
                </button>
              </p>
            )}
          </div>

          <button className="back-btn" onClick={() => navigate('/', { replace: true })} disabled={loading}>
            Volver al inicio
          </button>
          <div style={{ height: '20px' }}></div>
        </div>
      </div>
    </div>
  );
};
