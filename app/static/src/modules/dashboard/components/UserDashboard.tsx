import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  FiSettings, FiRefreshCw, FiMenu, FiX, FiHome, FiMail, FiHelpCircle, FiUser, FiUserPlus
} from 'react-icons/fi';
import './UserDashboard.css';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardHome } from './DashboardHome';
import { UserConfig } from './UserConfig';
import { ProfileOverlay } from './admin/ProfileOverlay';
import { AprendizDashboardHome } from './aprendiz/AprendizDashboardHome';
import { AprendizLoans } from './aprendiz/AprendizLoans';
import { AprendizReservations } from './aprendiz/AprendizReservations';
import { AprendizCatalog } from './aprendiz/AprendizCatalog';
import { AprendizHistory } from './aprendiz/AprendizHistory';
import { AprendizSolicitudes } from './aprendiz/AprendizSolicitudes';
import { NotificationBell } from '../../../shared/NotificationBell';
import { AnimatedRobotIcon } from '../../../components/ui/AnimatedRobotIcon';
import { PersonalAssistant } from './PersonalAssistant';
import { NotificationsPage } from './NotificationsPage';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  email?: string;
  correo?: string;
  role?: { name: string };
  rol?: { nombre: string };
  perfilCompleto?: boolean;
}

interface UserDashboardProps {
  user: UserData;
  onLogout: () => void;
  onGoToHome: () => void;
  onLogin?: () => void;
  onRegister?: () => void;
  onUserUpdate?: (userData: any) => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({
  user, onLogout, onUserUpdate,
}) => {
  const navigate = useNavigate();
  const { '*': sectionParam } = useParams();
  const activeSection = sectionParam || 'home';

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(
    (localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark'
  );

  const isGuest = user.id === 0;
  const currentRole = user.role?.name || user.rol?.nombre;
  const isPendingUser = !isGuest && !currentRole;

  useEffect(() => {
    if (!isGuest && currentRole) {
      const roleUpper = currentRole.toUpperCase();
      if (roleUpper === 'ADMIN') {
        navigate('/admin', { replace: true });
      } else if (roleUpper === 'BIBLIOTECARIO') {
        navigate('/bibliotecario', { replace: true });
      } else if (roleUpper === 'ALMACENISTA') {
        navigate('/almacenista', { replace: true });
      } else if (roleUpper === 'SOPORTE TÉCNICO' || roleUpper === 'SOPORTE TECNICO' || roleUpper === 'SOPORTE_TECNICO' || roleUpper === 'SOPORTE') {
        navigate('/soporte', { replace: true });
      }
    }
  }, [currentRole, isGuest, navigate]);

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
      return;
    }
    navigate(`/dashboard/${section}`);
    setIsMobileSidebarOpen(false);
  };

  const initials = (user.name || user.nombre || '??')
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`dashboard-layout theme-${theme}`}>
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
          <span>BIBLIOTECA & ALMACÉN SENA</span>
        </div>

        <div className="topnav-right">
          <div className="topnav-links hidden-mobile">
            {isGuest && (
              <a href="#" onClick={(e) => { e.preventDefault(); navigate('/'); }}>
                <FiHome className="nav-icon" /> INICIO
              </a>
            )}
            <a href="#contact">
              <FiMail className="nav-icon" /> CONTACTO
            </a>
            <a href="#help">
              <AnimatedRobotIcon className="nav-icon" /> ASISTENTE PERSONAL
            </a>
          </div>

          {isGuest ? (
            <div className="topnav-guest-actions">
              <button className="btn-text" onClick={() => navigate('/login')}>INICIAR SESIÓN</button>
              <button className="btn-outline" onClick={() => navigate('/register')}>CREAR CUENTA</button>
            </div>
          ) : (
            <>
              <NotificationBell onNavigate={handleNavigate} />
              <div className="topnav-user">
                <div className="avatar-circle" style={{ cursor: 'default' }}>{initials}</div>
              </div>
            </>
          )}
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
        <DashboardSidebar
          activeSection={activeSection}
          onNavigate={handleNavigate}
          isGuest={isGuest}
          isPendingUser={isPendingUser}
          user={user}
          onLogout={onLogout}
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isMobileOpen={isMobileSidebarOpen}
        />

        <main className="dashboard-main-content">
          {activeSection === 'home' && (
            currentRole === 'APRENDIZ' ? (
              <AprendizDashboardHome user={user} onNavigate={(s) => navigate(`/dashboard/${s}`)} />
            ) : (
              <DashboardHome
                user={user}
                isGuest={isGuest}
                isPendingUser={isPendingUser}
                onNavigate={(s) => navigate(`/dashboard/${s}`)}
              />
            )
          )}
          {activeSection === 'explore' && (
            currentRole === 'APRENDIZ' ? (
              <AprendizCatalog />
            ) : (
              <AprendizCatalog isGuest={isGuest} />
            )
          )}
          {activeSection === 'loans' && currentRole === 'APRENDIZ' && <AprendizLoans />}
          {activeSection === 'reservations' && currentRole === 'APRENDIZ' && <AprendizReservations />}
          {activeSection === 'history' && currentRole === 'APRENDIZ' && <AprendizHistory />}
          {(activeSection === 'config' || activeSection === 'update') && !isGuest && (
            <UserConfig user={user} />
          )}
          {activeSection === 'help' && <PersonalAssistant user={user} />}
          {activeSection === 'notifications' && !isGuest && <NotificationsPage />}
          {activeSection === 'guest' && isGuest && (
            <DashboardHome
              user={user}
              isGuest={isGuest}
              isPendingUser={isPendingUser}
              onNavigate={(s) => navigate(`/dashboard/${s}`)}
            />
          )}
        </main>
      </div>

      {showProfileModal && !isGuest && (
        <ProfileOverlay
          user={user as any}
          onClose={() => setShowProfileModal(false)}
          onSave={(photo) => onUserUpdate?.({ profile_image: photo })}
        />
      )}
    </div>
  );
};
