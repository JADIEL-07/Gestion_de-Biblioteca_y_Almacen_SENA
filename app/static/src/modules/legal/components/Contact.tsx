import React, { Suspense, useState } from 'react';
import {
  FiArrowLeft, FiMail, FiUsers, FiTarget, FiCompass, FiSearch, FiBookOpen,
  FiCalendar, FiClock, FiTool, FiMapPin, FiPhone, FiHelpCircle, FiX,
} from 'react-icons/fi';
import './Terms.css';
import { FloatingParticles } from '../../../components/ui/FloatingParticles';
import { HeroBackground } from '../../../components/ui/HeroBackground';

const PersonalAssistant = React.lazy(() =>
  import('../../dashboard/components/PersonalAssistant').then(m => ({ default: m.PersonalAssistant }))
);

// Servicios reales que el sistema ofrece al usuario (acciones, no categorías del
// catálogo, que ya se muestran en la grilla de la portada).
const CONTACT_SERVICES = [
  {
    icon: <FiSearch />,
    title: 'Consulta de catálogo',
    description: 'Explora libros, equipos, herramientas e insumos disponibles en tiempo real.'
  },
  {
    icon: <FiBookOpen />,
    title: 'Préstamos',
    description: 'Solicita y gestiona el préstamo de los recursos que necesitas para tu formación.'
  },
  {
    icon: <FiCalendar />,
    title: 'Reservas',
    description: 'Aparta con anticipación el elemento que necesitas y retíralo dentro del tiempo límite.'
  },
  {
    icon: <FiClock />,
    title: 'Historial',
    description: 'Consulta el estado y el historial completo de tus préstamos y reservas.'
  },
  {
    icon: <FiTool />,
    title: 'Reporte de incidencias',
    description: 'Informa daños o novedades y haz seguimiento junto al equipo de soporte técnico.'
  },
];

export const Contact = () => {
  const [showAssistant, setShowAssistant] = useState(false);

  return (
    <div className="terms-wrapper">
      <HeroBackground variant="panel" alt="Biblioteca SENA" />
      <FloatingParticles />

      <div className="terms-container">
        <div className="terms-glass-card">
          <header className="terms-header">
            <div className="terms-icon-box">
              <FiMail />
            </div>
            <h1>CONTÁCTANOS</h1>
            <p>Biblioteca y Almacén SENA — Sede Vélez, Santander</p>
          </header>

          <div className="terms-content">
            <div className="tab-pane fade-in contact-inner">
              <div className="info-card card contact-about-card">
                <h3><FiUsers className="contact-heading-icon" /> ¿Quiénes somos?</h3>
                <p>
                  La Biblioteca y Almacén del SENA es el punto de encuentro entre aprendices, instructores y
                  funcionarios con el material bibliográfico, los equipos y las herramientas que necesitan
                  para su formación. Ponemos a disposición de la comunidad educativa un sistema organizado,
                  trazable y accesible que acompaña cada etapa del proceso de aprendizaje dentro del centro
                  de formación.
                </p>
              </div>

              <div className="mv-grid">
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiTarget /></div>
                  <h3>Misión</h3>
                  <p>
                    Facilitar el acceso oportuno y organizado al conocimiento y a los recursos físicos del
                    centro de formación, apoyando la labor de aprendices e instructores mediante un control
                    claro, trazable y disponible en todo momento.
                  </p>
                </div>
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiCompass /></div>
                  <h3>Visión</h3>
                  <p>
                    Ser un espacio de aprendizaje moderno, accesible y respaldado por tecnología, donde
                    consultar, reservar y hacer seguimiento a los recursos institucionales sea simple,
                    rápido y confiable para toda la comunidad SENA.
                  </p>
                </div>
              </div>

              <h3 className="contact-subheading">Nuestros servicios</h3>
              <div className="contact-services-grid">
                {CONTACT_SERVICES.map((service) => (
                  <div className="service-card-mini" key={service.title}>
                    <div className="service-icon-wrapper-mini">{service.icon}</div>
                    <h3>{service.title}</h3>
                    <p>{service.description}</p>
                  </div>
                ))}
              </div>

              <h3 className="contact-subheading">Información de contacto</h3>
              <div className="contact-info-grid">
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiMapPin /></div>
                  <h3>Sede</h3>
                  <p>SENA — Sede Vélez, Santander</p>
                  <a
                    href="https://maps.app.goo.gl/1A9ELVhK6hsYwj2TA"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="contact-info-link"
                  >
                    Ver en Google Maps
                  </a>
                </div>
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiPhone /></div>
                  <h3>Teléfono</h3>
                  <p>Línea de atención al ciudadano</p>
                  <a href="tel:018000910270" className="contact-info-link">018000910270</a>
                </div>
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiClock /></div>
                  <h3>Horario</h3>
                  <p>Lunes a Viernes: 6:00 AM – 10:00 PM</p>
                  <p>Sábados, domingos y festivos: Cerrado</p>
                </div>
                <div className="service-card-mini">
                  <div className="service-icon-wrapper-mini"><FiMail /></div>
                  <h3>Correo</h3>
                  <a href="mailto:gestion.sena.b@gmail.com" className="contact-info-link">
                    gestion.sena.b@gmail.com
                  </a>
                </div>
              </div>

              <div className="info-card card contact-location-card">
                <h4><FiMapPin className="contact-heading-icon" /> Ubicación dentro de la sede</h4>
                <ul>
                  <li><strong>Biblioteca:</strong> Bloque Principal, primer piso, junto al área administrativa.</li>
                  <li><strong>Almacén de equipos:</strong> al fondo del pasillo técnico, junto a los talleres de electricidad y automatización.</li>
                </ul>
              </div>

              <div className="help-banner">
                <FiHelpCircle className="help-banner-icon" />
                <div className="help-banner-text">
                  <h4>¿Tienes alguna pregunta o inconveniente?</h4>
                  <p>Nuestro equipo está disponible para ayudarte.</p>
                </div>
                <button className="btn help-banner-btn" onClick={() => setShowAssistant(true)}>
                  Contactar soporte
                </button>
              </div>
            </div>
          </div>

          <footer className="terms-footer">
            <button className="btn-back-home" onClick={() => window.history.back()}>
              <FiArrowLeft /> REGRESAR AL INICIO
            </button>
          </footer>
        </div>
      </div>

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
};
