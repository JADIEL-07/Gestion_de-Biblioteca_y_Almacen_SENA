import React, { useState, useEffect, useRef, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';

// Lazy loaded modules (Code Splitting)
const LoginForm = React.lazy(() => import('./modules/auth/components/LoginForm').then(m => ({ default: m.LoginForm })));
const Terms = React.lazy(() => import('./modules/legal/components/Terms').then(m => ({ default: m.Terms })));
const Privacy = React.lazy(() => import('./modules/legal/components/Privacy').then(m => ({ default: m.Privacy })));
const ForgotPassword = React.lazy(() => import('./modules/auth/components/ForgotPassword').then(m => ({ default: m.ForgotPassword })));
const ResetPassword = React.lazy(() => import('./modules/auth/components/ResetPassword').then(m => ({ default: m.ResetPassword })));
const ForcePasswordChange = React.lazy(() => import('./modules/auth/components/ForcePasswordChange').then(m => ({ default: m.ForcePasswordChange })));
const DeviceApproval = React.lazy(() => import('./modules/auth/components/DeviceApproval').then(m => ({ default: m.DeviceApproval })));
const UserDashboard = React.lazy(() => import('./modules/dashboard/components/UserDashboard').then(m => ({ default: m.UserDashboard })));
const AdminDashboard = React.lazy(() => import('./modules/dashboard/components/admin/AdminDashboard').then(m => ({ default: m.AdminDashboard })));
const BibliotecarioDashboard = React.lazy(() => import('./modules/dashboard/components/bibliotecario/BibliotecarioDashboard').then(m => ({ default: m.BibliotecarioDashboard })));
const AlmacenistaDashboard = React.lazy(() => import('./modules/dashboard/components/almacenista/AlmacenistaDashboard').then(m => ({ default: m.AlmacenistaDashboard })));
const SoporteDashboard = React.lazy(() => import('./modules/dashboard/components/soporte/SoporteDashboard').then(m => ({ default: m.SoporteDashboard })));
import {
  FaTwitter,
  FaFacebookF,
  FaInstagram,
  FaYoutube
} from 'react-icons/fa';
import {
  FiHome,
  FiMail,
  FiUser,
  FiHelpCircle,
  FiUserPlus,
  FiMenu,
  FiX,
} from 'react-icons/fi';

import { SERVICES_DATA } from './shared/constants';
import { apiFetch } from './shared/api';
const senaBg = '/assets/images/sena-library-bg.png';
import { FloatingParticles } from './components/ui/FloatingParticles';
import { HeroBackground } from './components/ui/HeroBackground';
import { AnimatedRobotIcon } from './components/ui/AnimatedRobotIcon';

// Helper component for reveal on scroll animations
function RevealOnScroll({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        } else {
          setIsVisible(false); // Reset so it animates again next time the user scrolls
        }
      },
      {
        threshold: 0.05,
        rootMargin: '0px 0px -30px 0px',
      }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => {
      if (ref.current) {
        observer.unobserve(ref.current);
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal-item ${isVisible ? 'revealed' : ''}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// ── Landing Page ──────────────────────────────────────────────────────────────
const PersonalAssistant = React.lazy(() => import('./modules/dashboard/components/PersonalAssistant').then(m => ({ default: m.PersonalAssistant })));

function Landing({ loggedUser, onLogout }: { loggedUser: any; onLogout: () => void }) {
  const navigate = useNavigate();
  const [showAssistant, setShowAssistant] = useState(false);
  const [menuOpenLanding, setMenuOpenLanding] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark'
  );

  useEffect(() => {
    // Sincronizar el tema inicial según las clases de document.body
    const isLightNow = document.body.classList.contains('theme-light');
    setTheme(isLightNow ? 'light' : 'dark');

    // Usar MutationObserver para reaccionar inmediatamente a los cambios de clase en document.body
    const observer = new MutationObserver(() => {
      const isLight = document.body.classList.contains('theme-light');
      setTheme(isLight ? 'light' : 'dark');
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const syncTheme = () => {
      const storedTheme = (localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark';
      setTheme(storedTheme);
    };
    window.addEventListener('storage', syncTheme);

    return () => {
      observer.disconnect();
      window.removeEventListener('storage', syncTheme);
    };
  }, []);

  return (
    <div className={`home-wrapper ${theme === 'light' ? 'theme-light' : 'theme-dark'}`}>
      <nav className="main-nav">
        <div className="nav-logo">
          <div className="mini-logo-box">
            <img src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg" alt="SENA Logo" />
          </div>
          <span>BIBLIOTECA & ALMACÉN SENA</span>
        </div>

        <button
          className={`nav-hamburger ${mobileNavOpen ? 'open' : ''}`}
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
          aria-label={mobileNavOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={mobileNavOpen}
        >
          {mobileNavOpen ? <FiX size={22} /> : <FiMenu size={22} />}
        </button>

        <div className={`nav-links ${mobileNavOpen ? 'mobile-open' : ''}`}>
          <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); setMobileNavOpen(false); }}>
            <FiHome className="nav-icon" /> INICIO
          </a>
          <a href="#contact" onClick={() => setMobileNavOpen(false)}>
            <FiMail className="nav-icon" /> CONTACTO
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); setMobileNavOpen(false); setShowAssistant(true); }}>
            <AnimatedRobotIcon className="nav-icon" /> ASISTENTE PERSONAL
          </a>

          {loggedUser ? (
            <div className="nav-avatar" style={{ overflow: 'hidden' }}>
              {loggedUser.profile_image
                ? <img src={loggedUser.profile_image} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (loggedUser.name || loggedUser.nombre || '').split(' ').map((n: any) => n[0]).slice(0, 2).join('').toUpperCase()
              }
            </div>
          ) : (
            <>
              <a href="#" className="nav-link-login" onClick={(e) => { e.preventDefault(); navigate('/login'); setMobileNavOpen(false); }}>
                <FiUser className="nav-icon" /> INICIAR SESIÓN
              </a>
              <a href="#" className="btn-create-account" onClick={(e) => { e.preventDefault(); navigate('/register'); setMobileNavOpen(false); }}>
                <FiUserPlus className="nav-icon" /> CREAR CUENTA
              </a>
            </>
          )}
        </div>
      </nav>

      <section className="hero-section">
        <HeroBackground variant="hero" alt="Fondo Biblioteca & Almacén SENA">
          <FloatingParticles />
        </HeroBackground>

        <RevealOnScroll delay={100}>
          <div className="hero-content">
            <h1>SISTEMA INTEGRAL: BIBLIOTECA, ALMACÉN E INVENTARIO</h1>
            <p>Gestión unificada de material bibliográfico, equipos, herramientas e insumos para el centro de formación.</p>
          </div>
        </RevealOnScroll>

        <div className="services-grid-overlay">
          {SERVICES_DATA.map((service, index) => (
            <RevealOnScroll key={service.id} delay={index * 80}>
              <div className="service-card-mini">
                <div className="service-icon-wrapper-mini">
                  {service.icon || <span>📦</span>}
                </div>
                <h3>{service.title}</h3>
                <p>{service.description}</p>
              </div>
            </RevealOnScroll>
          ))}
        </div>

        <RevealOnScroll delay={200}>
          <div className="hero-cta-footer">
            <p className="privacy-text">
              Al hacer clic en Comienza ahora, aceptas nuestros{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/terms'); }}>terminos</a>{' '}
              y{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/privacy'); }}>politica de privacidad</a>
            </p>
            <button
              className="btn cta-home-btn"
              onClick={() => {
                if (loggedUser) {
                  const role = (loggedUser.role?.name || loggedUser.rol?.nombre || '').toUpperCase();
                  navigate(role === 'ADMIN' ? '/admin' : role === 'BIBLIOTECARIO' ? '/bibliotecario' : role === 'ALMACENISTA' ? '/almacenista' : role === 'SOPORTE TÉCNICO' || role === 'SOPORTE TECNICO' || role === 'SOPORTE_TECNICO' || role === 'SOPORTE' ? '/soporte' : '/dashboard');
                } else {
                  navigate('/dashboard/guest');
                }
              }}
            >
              COMIENZA AHORA
            </button>
          </div>
        </RevealOnScroll>
      </section>

      <footer className="main-footer">
        <div className="footer-container">
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg"
            alt="Logo SENA Blanco"
            className="footer-logo"
          />
          <span className="footer-divider">|</span>
          <div className="footer-socials">
            <FaTwitter title="Twitter" />
            <FaFacebookF title="Facebook" />
            <FaInstagram title="Instagram" />
            <FaYoutube title="YouTube" />
          </div>
          <span className="footer-divider">|</span>
          <div className="footer-info-block">
            <div className="info-row-top">
              <a href="https://maps.app.goo.gl/1A9ELVhK6hsYwj2TA" target="_blank" rel="noopener noreferrer" className="location-link">
                <strong>Sede SENA</strong> - Vélez, Santander
              </a>
              <span className="divider-sm">|</span>
              <span>Atención al ciudadano: 018000910270</span>
              <span className="divider-sm">|</span>
              <span>Biblioteca y Almacén @ 2026</span>
            </div>
            <div className="schedule-row">
              <span>🕒 <strong>Lunes a Viernes:</strong> 6:00 AM – 10:00 PM</span>
              <span className="divider-ghost">|</span>
              <span><strong>Sábado y Domingo:</strong> Cerrado</span>
            </div>
          </div>
        </div>
      </footer>

      {showAssistant && (
        <div className="assistant-overlay">
          <button className="assistant-close-btn" onClick={() => setShowAssistant(false)}>
            <FiX size={24} />
          </button>
          <Suspense fallback={
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-primary)' }}>
              Cargando asistente...
            </div>
          }>
            <PersonalAssistant
              user={{ nombre: 'Invitado SENA', rol: { nombre: 'Invitado' }, id: 0 }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
function AppRoutes() {
  const navigate = useNavigate();
  const storedUser = localStorage.getItem('user');
  const [loggedUser, setLoggedUser] = useState<any>(storedUser ? JSON.parse(storedUser) : null);

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    localStorage.removeItem('force_password_change');
    setLoggedUser(null);
    navigate('/', { replace: true });
  };

  const handleLoginSuccess = (user: any) => {
    // Si el login marcó must_change_password, también lo guardamos en el flag local
    if (user?.must_change_password) {
      localStorage.setItem('force_password_change', '1');
    }
    setLoggedUser(user);
  };

  const handleUserUpdate = (updatedUser: any) => {
    const newUser = { ...loggedUser, ...updatedUser };
    setLoggedUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
  };

  // ── Latido de sesión ──────────────────────────────────────────────
  // Consulta el backend cada 25 s (y al volver a la pestaña). Si la sesión de
  // este dispositivo fue cerrada desde otro lado, apiFetch recibe 401, no puede
  // renovar y muestra la pantalla "sesión expirada" (5 s) antes de ir al inicio.
  useEffect(() => {
    if (!loggedUser) return;
    let stopped = false;
    const ping = () => {
      if (stopped || document.hidden) return;
      apiFetch('/api/v1/auth/session-check').catch(() => { /* apiFetch maneja el 401 */ });
    };
    const id = window.setInterval(ping, 25000);
    const onFocus = () => ping();
    window.addEventListener('focus', onFocus);
    ping();
    return () => {
      stopped = true;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [loggedUser]);

  const rawRole = loggedUser?.role?.name || loggedUser?.rol?.nombre || '';
  const userRole = rawRole.toUpperCase();
  const isAdmin = userRole === 'ADMIN';
  const isBibliotecario = userRole === 'BIBLIOTECARIO';
  const isAlmacenista = userRole === 'ALMACENISTA';
  const isSoporte = userRole === 'SOPORTE TÉCNICO' || userRole === 'SOPORTE TECNICO' || userRole === 'SOPORTE_TECNICO' || userRole === 'SOPORTE';
  const isStaff = isBibliotecario || isAlmacenista || isSoporte;

  // ── Si el usuario tiene contraseña temporal, bloquear toda la app hasta que la cambie
  const mustChangePassword = loggedUser && (loggedUser.must_change_password === true
    || localStorage.getItem('force_password_change') === '1');

  if (mustChangePassword) {
    return (
      <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Cargando...</div>}>
        <ForcePasswordChange
          onDone={(u) => { setLoggedUser(u); }}
          onLogout={handleLogout}
        />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', width: '100vw', background: 'var(--bg-main, #f0f2f5)' }}><div className="loading-spinner" style={{ border: '4px solid rgba(0,0,0,0.1)', borderLeftColor: '#39A900', borderRadius: '50%', width: '50px', height: '50px', animation: 'spin 1s linear infinite' }}></div><style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style></div>}>
      <Routes>
        {/* Public pages */}
        <Route path="/" element={<Landing loggedUser={loggedUser} onLogout={handleLogout} />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* Auth */}
        <Route
          path="/login"
          element={
            loggedUser
              ? <Navigate to={isAdmin ? '/admin' : isBibliotecario ? '/bibliotecario' : isAlmacenista ? '/almacenista' : isSoporte ? '/soporte' : '/dashboard'} replace />
              : <LoginForm mode="login" onLoginSuccess={handleLoginSuccess} />
          }
        />
        <Route
          path="/register"
          element={
            loggedUser
              ? <Navigate to={isAdmin ? '/admin' : isBibliotecario ? '/bibliotecario' : isAlmacenista ? '/almacenista' : isSoporte ? '/soporte' : '/dashboard'} replace />
              : <LoginForm mode="register" onLoginSuccess={handleLoginSuccess} />
          }
        />
        <Route path="/aprobar-dispositivo" element={<DeviceApproval />} />

        {/* Admin dashboard */}
        <Route
          path="/admin/*"
          element={
            loggedUser && isAdmin
              ? <AdminDashboard user={loggedUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
              : <Navigate to="/login" replace />
          }
        />

        {/* Bibliotecario dashboard */}
        <Route
          path="/bibliotecario/*"
          element={
            loggedUser && isBibliotecario
              ? <BibliotecarioDashboard user={loggedUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
              : <Navigate to="/login" replace />
          }
        />

        {/* Almacenista dashboard */}
        <Route
          path="/almacenista/*"
          element={
            loggedUser && isAlmacenista
              ? <AlmacenistaDashboard user={loggedUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
              : <Navigate to="/login" replace />
          }
        />

        {/* Soporte Técnico dashboard */}
        <Route
          path="/soporte/*"
          element={
            loggedUser && isSoporte
              ? <SoporteDashboard user={loggedUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate} />
              : <Navigate to="/login" replace />
          }
        />

        {/* User / Aprendiz / Guest dashboard */}
        <Route
          path="/dashboard/*"
          element={
            loggedUser && isAdmin ? <Navigate to="/admin" replace />
            : loggedUser && isBibliotecario ? <Navigate to="/bibliotecario" replace />
            : loggedUser && isAlmacenista ? <Navigate to="/almacenista" replace />
            : loggedUser && isSoporte ? <Navigate to="/soporte" replace />
            : <UserDashboard
                user={loggedUser ?? { nombre: 'Invitado SENA', rol: { nombre: 'Invitado' }, id: 0 }}
                onLogout={loggedUser ? handleLogout : () => {}}
                onGoToHome={() => {}}
                onLogin={() => {}}
                onRegister={() => {}}
                onUserUpdate={loggedUser ? handleUserUpdate : undefined}
              />
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}


function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
