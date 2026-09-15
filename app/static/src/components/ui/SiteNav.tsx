import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiHome, FiMail, FiUser, FiUserPlus, FiMenu, FiX } from 'react-icons/fi';
import { AnimatedRobotIcon } from './AnimatedRobotIcon';

interface SiteNavProps {
  /** Resalta el link de la sección actual ("dónde estoy"). Se omite en
   * Términos y Privacidad a propósito — ahí solo se pidió mantener la barra,
   * sin indicar ubicación. */
  active?: 'contacto' | 'asistente';
  /** Cuando se da (solo el Inicio), abre el asistente como overlay local en
   * vez de navegar — en cualquier otra página se navega al Inicio pidiendo
   * que se abra el asistente ahí. */
  onAssistantClick?: () => void;
}

/** Barra superior compartida entre el Inicio, Contacto, Términos y Privacidad,
 * y el asistente personal del invitado — antes cada vista tenía la suya (o
 * ninguna), lo que hacía perder la navegación al entrar a esas secciones. */
export const SiteNav: React.FC<SiteNavProps> = ({ active, onAssistantClick }) => {
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggedUser, setLoggedUser] = useState<any>(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const sync = () => {
      try {
        const raw = localStorage.getItem('user');
        setLoggedUser(raw ? JSON.parse(raw) : null);
      } catch {
        setLoggedUser(null);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const handleAssistantClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileNavOpen(false);
    if (onAssistantClick) {
      onAssistantClick();
    } else {
      navigate('/', { state: { openAssistant: true } });
    }
  };

  return (
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
        <a
          href="#"
          className={active === 'contacto' ? 'nav-link-current' : ''}
          onClick={(e) => { e.preventDefault(); navigate('/contacto'); setMobileNavOpen(false); }}
        >
          <FiMail className="nav-icon" /> CONTACTO
        </a>
        <a
          href="#"
          className={active === 'asistente' ? 'nav-link-current' : ''}
          onClick={handleAssistantClick}
        >
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
  );
};
