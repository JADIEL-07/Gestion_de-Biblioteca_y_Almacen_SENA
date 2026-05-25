import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMail, FiMenu, FiX } from 'react-icons/fi';
import { SoporteSidebar } from './SoporteSidebar';
import { SoporteHome } from './SoporteHome';
import { UserConfig } from '../UserConfig';
import { ProfileOverlay } from '../admin/ProfileOverlay'; // Reusing from admin
import { NotificationBell } from '../../../../shared/NotificationBell';
import { MaintenanceManagement } from '../admin/MaintenanceManagement'; // Reusing if exists, or just placeholder
import { SystemReports } from '../admin/SystemReports';
import { SoporteIncidencias } from './SoporteIncidencias';
import { SoporteHistorial } from './SoporteHistorial';
import { SoporteRepuestos } from './SoporteRepuestos';
import { SoporteSolicitudes } from './SoporteSolicitudes';
import { StaffChat } from '../../../shared/StaffChat';
import './SoporteDashboard.css';
import '../UserDashboard.css';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';
import { PersonalAssistant } from '../PersonalAssistant';
import { NotificationsPage } from '../NotificationsPage';
import { DashboardBg } from '../DashboardBg';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  role?: { name: string };
  rol?: { nombre: string };
  profile_image?: string;
}

interface SoporteDashboardProps {
  user: UserData;
  onLogout: () => void;
  onUserUpdate: (userData: any) => void;
}

export const SoporteDashboard: React.FC<SoporteDashboardProps> = ({ user, onLogout, onUserUpdate }) => {
  const navigate = useNavigate();
  const { '*': sectionParam } = useParams();
  const activeSection = sectionParam || 'dashboard';

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark'
  );

  useEffect(() => {
    const syncTheme = () => {
      const storedTheme = (localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark';
      setTheme(storedTheme);
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  const handleNavigate = (section: string) => {
    if (section === 'profile') {
      setShowProfileModal(true);
    } else {
      navigate(`/soporte/${section}`);
      setIsMobileSidebarOpen(false);
    }
  };

  const initials = (user.name || user.nombre || '??')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const sectionTitle: Record<string, string> = {
    dashboard: 'Panel de Control Técnico',
    incidencias: 'Gestión de Reportes',
    mantenimientos: 'Área de Trabajo',
    repuestos: 'Gestión de Repuestos',
    historial: 'Historial Técnico',
    solicitudes: 'Solicitudes de Aprendices',
    'staff-chat': 'Chat Interno del Equipo',
    config: 'Configuración',
    help: 'Asistente Personal',
    notifications: 'Centro de Notificaciones',
  };

  return (
    <div className={`dashboard-layout theme-${theme} soporte-specific`}>
      <DashboardBg />
      {/* TOP NAVIGATION */}
      <nav className="dashboard-topnav">
        <button
          className="topnav-mobile-toggle"
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          aria-label={isMobileSidebarOpen ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={isMobileSidebarOpen}
        >
          {isMobileSidebarOpen ? <FiX size={22} /> : <FiMenu size={22} />}
        </button>

        <div className="topnav-logo">
          <img
            src="https://upload.wikimedia.org/wikipedia/commons/8/83/Sena_Colombia_logo.svg"
            alt="SENA"
            className="topnav-logo-img"
          />
          <span>BIBLIOTECA & ALMACÉN SENA (SOPORTE TÉCNICO)</span>
        </div>

        <div className="topnav-right">
          <div className="topnav-links hidden-mobile">
            <a href="#contact">
              <FiMail className="nav-icon" /> CONTACTO
            </a>
            <a href="#help">
              <AnimatedRobotIcon className="nav-icon" /> ASISTENTE PERSONAL
            </a>
          </div>

          <NotificationBell onNavigate={handleNavigate} />

          <div className="topnav-user">
            <div className="avatar-circle" style={{ background: 'var(--sena-green)', overflow: 'hidden' }}>
              {user.profile_image ? (
                <img src={user.profile_image} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* BODY (SIDEBAR + MAIN CONTENT) */}
      <div className="dashboard-body">
        {isMobileSidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <SoporteSidebar
          activeSection={activeSection}
          onNavigate={handleNavigate}
          user={user}
          onLogout={onLogout}
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isMobileOpen={isMobileSidebarOpen}
        />

        <main className="dashboard-main-content">
          <div className="content-container">
            {activeSection === 'dashboard' && <SoporteHome user={user} />}
            {activeSection === 'config' && <UserConfig user={user} />}
            {activeSection === 'mantenimientos' && <MaintenanceManagement />}
            {activeSection === 'help' && <PersonalAssistant user={user} />}
            {activeSection === 'reportes' && <SystemReports />}
            {activeSection === 'incidencias' && <SoporteIncidencias user={user} />}
            {activeSection === 'historial' && <SoporteHistorial />}
            {activeSection === 'repuestos' && <SoporteRepuestos />}
            {activeSection === 'solicitudes' && <SoporteSolicitudes user={user} />}
            {activeSection === 'staff-chat' && <StaffChat user={user} />}
            {activeSection === 'notifications' && <NotificationsPage />}
            {!['dashboard', 'config', 'mantenimientos', 'help', 'reportes', 'incidencias', 'historial', 'repuestos', 'solicitudes', 'staff-chat', 'notifications'].includes(activeSection) && (
              <div className="placeholder-view">
                <h2>Sección en construcción</h2>
                <p>El módulo de {sectionTitle[activeSection] || activeSection} estará disponible pronto.</p>
              </div>
            )}
          </div>
        </main>
      </div>

      {showProfileModal && (
        <ProfileOverlay
          user={user}
          onClose={() => setShowProfileModal(false)}
          onSave={(photo) => onUserUpdate({ profile_image: photo })}
        />
      )}
    </div>
  );
};
