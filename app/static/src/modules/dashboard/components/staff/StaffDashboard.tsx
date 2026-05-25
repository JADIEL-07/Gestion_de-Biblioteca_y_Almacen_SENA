import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMail, FiHelpCircle, FiMenu, FiX } from 'react-icons/fi';
import { StaffSidebar } from './StaffSidebar';
import { UserConfig } from '../UserConfig';
import { NotificationBell } from '../../../../shared/NotificationBell';
import { InventoryManagement } from '../admin/InventoryManagement';
import { StaffLoans } from './StaffLoans';
import { StaffHome } from './StaffHome';
import { ProfileOverlay } from '../admin/ProfileOverlay';
import '../admin/AdminDashboard.css';
import '../UserDashboard.css';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';
import { PersonalAssistant } from '../PersonalAssistant';
import { NotificationsPage } from '../NotificationsPage';
import { DashboardBg } from '../DashboardBg';

interface StaffDashboardProps {
  user: any;
  onLogout: () => void;
  onUserUpdate?: (userData: any) => void;
}

export const StaffDashboard: React.FC<StaffDashboardProps> = ({ user, onLogout, onUserUpdate }) => {
  const navigate = useNavigate();
  const { '*': sectionParam } = useParams();
  const activeSection = sectionParam || 'home';

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
      navigate(`/staff/${section}`);
      setIsMobileSidebarOpen(false);
    }
  };

  const roleName = (user?.role?.name || user?.rol?.nombre || 'STAFF').toUpperCase();
  const depName = user?.dependency_name || user?.dependency_obj?.name || '';
  const topLabel = depName ? `${roleName} — ${depName}` : roleName;

  const initials = (user?.name || '??')
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={`dashboard-layout theme-${theme} admin-specific`}>
      <DashboardBg />
      {/* TOP NAVIGATION — igual que el Admin */}
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
          <span>BIBLIOTECA & ALMACÉN SENA ({topLabel})</span>
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
              {user?.profile_image ? (
                <img src={user.profile_image} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                initials
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* BODY */}
      <div className="dashboard-body">
        {isMobileSidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <StaffSidebar
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
            {activeSection === 'home'      && <StaffHome user={user} />}
            {activeSection === 'inventory' && <InventoryManagement user={user} />}
            {activeSection === 'loans'     && <StaffLoans user={user} />}
            {activeSection === 'config'    && <UserConfig user={user} />}
            {activeSection === 'help'      && <PersonalAssistant user={user} />}
            {activeSection === 'notifications' && <NotificationsPage />}
          </div>
        </main>
      </div>

      {showProfileModal && (
        <ProfileOverlay
          user={user}
          onClose={() => setShowProfileModal(false)}
          onSave={(photo: string) => onUserUpdate?.({ profile_image: photo })}
        />
      )}
    </div>
  );
};
