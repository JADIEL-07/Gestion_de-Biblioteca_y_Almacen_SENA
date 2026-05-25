import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiMail, FiHelpCircle, FiMenu, FiX } from 'react-icons/fi';
import { AdminSidebar } from './AdminSidebar';
import { AdminHome } from './AdminHome';
import { UserConfig } from '../UserConfig';
import { UserManagement } from './UserManagement';
import { AuditLogs } from './AuditLogs';
import { LoanManagement } from './LoanManagement';
import { ReservationManagement } from './ReservationManagement';
import { MaintenanceManagement } from './MaintenanceManagement';
import { SystemReports } from './SystemReports';
import { InventoryManagement } from './InventoryManagement';
import { OutputManagement } from './OutputManagement';
import { ProfileOverlay } from './ProfileOverlay';
import { NotificationBell } from '../../../../shared/NotificationBell';
import './AdminDashboard.css';
import '../UserDashboard.css';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';
import { PersonalAssistant } from '../PersonalAssistant';
import { SoporteSolicitudes } from '../soporte/SoporteSolicitudes';
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

interface AdminDashboardProps {
  user: UserData;
  onLogout: () => void;
  onUserUpdate: (userData: any) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onLogout, onUserUpdate }) => {
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
      navigate(`/admin/${section}`);
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
    dashboard: 'Panel de Control General',
    inventory: 'Gestión de Inventario',
    'inventory-table': 'Tabla de Inventario',
    'inventory-locations': 'Gestión de Ubicaciones',
    'inventory-categories': 'Gestión de Categorías',
    loans: 'Control de Préstamos',
    users: 'Gestión de Usuarios',
    reports: 'Reportes Estadísticos',
    audit: 'Auditoría del Sistema',
    reservations: 'Control de Reservas',
    maintenance: 'Gestión de Mantenimiento',
    exits: 'Control de Salidas Controladas',
    config: 'Configuración del Sistema',
    help: 'Asistente Personal',
    notifications: 'Centro de Notificaciones',
  };

  return (
    <div className={`dashboard-layout theme-${theme} admin-specific`}>
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
          <span>BIBLIOTECA & ALMACÉN SENA (ADMIN)</span>
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
        <AdminSidebar
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
            {activeSection === 'dashboard' && <AdminHome />}
            {activeSection === 'config' && <UserConfig user={user} />}
            {activeSection === 'users' && <UserManagement />}
            {activeSection === 'audit' && <AuditLogs />}
            {activeSection === 'loans' && <LoanManagement />}
            {activeSection === 'reservations' && <ReservationManagement />}
            {activeSection === 'maintenance' && <MaintenanceManagement />}
            {activeSection === 'reports' && <SystemReports />}
            {(activeSection === 'inventory' || activeSection === 'inventory-table') && <InventoryManagement />}
            {activeSection === 'inventory-locations' && <InventoryManagement activeTab="locations" />}
            {activeSection === 'inventory-categories' && <InventoryManagement activeTab="categories" />}
            {activeSection === 'exits' && <OutputManagement />}
            {activeSection === 'help' && <PersonalAssistant user={user} />}
            {activeSection === 'solicitudes' && <SoporteSolicitudes user={user} />}
            {activeSection === 'notifications' && <NotificationsPage />}
            {!sectionTitle[activeSection] && (
              <div className="placeholder-view">
                <h2>Sección en construcción</h2>
                <p>El módulo de {activeSection} estará disponible pronto.</p>
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
