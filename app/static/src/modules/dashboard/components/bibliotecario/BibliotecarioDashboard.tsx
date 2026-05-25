import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMail, FiHelpCircle, FiMenu, FiX } from 'react-icons/fi';
import { BibliotecarioSidebar } from './BibliotecarioSidebar';
import { UserConfig } from '../UserConfig';
import { NotificationBell } from '../../../../shared/NotificationBell';
import { InventoryManagement } from '../admin/InventoryManagement';
import { StaffLoans } from '../staff/StaffLoans';
import { StaffHome } from '../staff/StaffHome';
import { ProfileOverlay } from '../admin/ProfileOverlay';
import { StaffChat } from '../../../shared/StaffChat';
import '../admin/AdminDashboard.css';
import '../UserDashboard.css';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';
import { PersonalAssistant } from '../PersonalAssistant';
import { NotificationsPage } from '../NotificationsPage';
import { DashboardBg } from '../DashboardBg';

interface Props {
  user: any;
  onLogout: () => void;
  onUserUpdate?: (userData: any) => void;
}

export const BibliotecarioDashboard: React.FC<Props> = ({ user, onLogout, onUserUpdate }) => {
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
      setTheme((localStorage.getItem('dashboard-theme') as 'dark' | 'light') ?? 'dark');
    };
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  }, []);

  const handleNavigate = (section: string) => {
    if (section === 'profile') {
      setShowProfileModal(true);
    } else {
      navigate(`/bibliotecario/${section}`);
      setIsMobileSidebarOpen(false);
    }
  };

  const initials = (user?.name || '??')
    .split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={`dashboard-layout theme-${theme} admin-specific`}>
      <DashboardBg />
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
          <span>BIBLIOTECA & ALMACÉN SENA (BIBLIOTECARIO)</span>
        </div>

        <div className="topnav-right">
          <div className="topnav-links hidden-mobile">
            <a href="#contact"><FiMail className="nav-icon" /> CONTACTO</a>
            <a href="#help"><AnimatedRobotIcon className="nav-icon" /> ASISTENTE PERSONAL</a>
          </div>
          <NotificationBell onNavigate={handleNavigate} />
          <div className="topnav-user">
            <div className="avatar-circle" style={{ background: 'var(--sena-green)', overflow: 'hidden' }}>
              {user?.profile_image
                ? <img src={user.profile_image} alt="Perfil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : initials}
            </div>
          </div>
        </div>
      </nav>

      <div className="dashboard-body">
        {isMobileSidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setIsMobileSidebarOpen(false)} aria-hidden="true" />
        )}

        <BibliotecarioSidebar
          activeSection={activeSection}
          onNavigate={handleNavigate}
          user={user}
          onLogout={onLogout}
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          isMobileOpen={isMobileSidebarOpen}
        />

        <main className="dashboard-main-content" onClick={() => setIsSidebarCollapsed(true)}>
          <div className="content-container">
            {activeSection === 'home'               && <StaffHome user={user} />}
            {activeSection === 'inventory'          && <InventoryManagement user={user} />}
            {(activeSection === 'inventory-locations' || activeSection === 'inventory-categories') && (
              <InventoryManagement activeTab={activeSection === 'inventory-locations' ? 'locations' : 'categories'} user={user} />
            )}
            {activeSection === 'loans'              && <StaffLoans user={user} />}
            {activeSection === 'config'             && <UserConfig user={user} />}
            {activeSection === 'help'               && <PersonalAssistant user={user} />}
            {activeSection === 'solicitudes'        && <StaffChat user={user} />}
            {activeSection === 'notifications'     && <NotificationsPage />}
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
