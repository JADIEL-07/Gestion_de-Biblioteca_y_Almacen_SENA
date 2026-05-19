import React from 'react';
import {
  FiHome, FiSearch, FiBookOpen, FiCalendar, FiClock,
  FiBell, FiHelpCircle, FiSettings, FiLogOut, FiMenu, FiEdit3, FiHeadphones
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../components/ui/AnimatedRobotIcon';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  role?: { name: string };
  rol?: { nombre: string };
}

interface SidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  isGuest: boolean;
  isPendingUser: boolean;
  user: UserData;
  onLogout: () => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
  isMobileOpen?: boolean;
}

export const DashboardSidebar: React.FC<SidebarProps> = ({
  activeSection,
  onNavigate,
  isGuest,
  isPendingUser,
  user,
  onLogout,
  isCollapsed = false,
  onToggle,
  isMobileOpen = false
}) => {
  const menuItems = [
    { id: 'home', label: 'Inicio', icon: <FiHome /> },
    { id: 'explore', label: 'Explorar elementos', icon: <FiSearch /> },
    ...(!isGuest ? [
      { id: 'loans', label: 'Mis préstamos', icon: <FiBookOpen />, restricted: true },
      { id: 'reservations', label: 'Mis reservas', icon: <FiCalendar />, restricted: true },
      { id: 'history', label: 'Historial', icon: <FiClock />, restricted: true },
    ] : []),
  ];

  const bottomItems = [
    { id: 'help', label: 'Asistente personal', icon: <AnimatedRobotIcon /> },
    ...(!isGuest ? [
      { id: 'notifications', label: 'Notificaciones', icon: <FiBell /> },
      { id: 'config', label: 'Configuración', icon: <FiSettings />, restricted: true },
    ] : []),
  ];

  const handleNav = (item: any) => {
    if (item.restricted) {
      if (isGuest) {
        alert('Esta sección requiere iniciar sesión.');
        return;
      }
      if (isPendingUser) {
        alert('Debes actualizar tu información para acceder a esta sección.');
        onNavigate('update');
        return;
      }
    }
    onNavigate(item.id);
  };

  const initials = isGuest ? 'IN' : (user.name || user.nombre || '??').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
  const currentRoleName = user.role?.name || user.rol?.nombre;
  const roleDisplay = isGuest ? 'Invitado' : (currentRoleName === 'ADMIN' ? 'Administrador' : (currentRoleName === 'APRENDIZ' ? 'Aprendiz' : 'Usuario'));

  return (
    <aside className={`dashboard-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-toggle-container">
        <button 
          className="sidebar-toggle-box" 
          onClick={onToggle}
          title={isCollapsed ? "Expandir" : "Colapsar"}
        >
          <FiMenu />
        </button>
      </div>

      <div className="sidebar-menu">
        {menuItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => handleNav(item)}
            title={isCollapsed ? item.label : ''}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {!isCollapsed && <span className="sidebar-label">{item.label}</span>}
          </button>
        ))}

        <div style={{ height: '1.2rem' }}></div>

        {bottomItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => handleNav(item)}
            title={isCollapsed ? item.label : ''}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {!isCollapsed && <span className="sidebar-label">{item.label}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }}></div>

      <div className="sidebar-footer">
        <div className="sidebar-divider" style={{ margin: '0.3rem 0', height: '1px', background: 'var(--border-color)', opacity: 0.1 }}></div>

        {/* PERFIL VERTICAL CENTRADO CON ICONO FLOTANTE */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem', marginTop: '0.5rem' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: isCollapsed ? '34px' : '40px',
              height: isCollapsed ? '34px' : '40px',
              borderRadius: '50%',
              background: 'var(--sena-green)',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: isCollapsed ? '0.8rem' : '0.9rem',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}>
              {initials}
            </div>
            
            {/* Lápiz flotante en la esquina */}
            {!isGuest && !isCollapsed && (
              <div 
                onClick={() => onNavigate('profile')}
                style={{
                  position: 'absolute',
                  top: '0',
                  right: '-2px',
                  background: 'var(--bg-card-light)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.65rem',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }}
              >
                <FiEdit3 />
              </div>
            )}
            
            {!isCollapsed && (
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.3rem', fontWeight: 600 }}>{roleDisplay}</span>
            )}
          </div>
        </div>

        {!isGuest && (
          <button
            className="sidebar-item logout-item"
            onClick={onLogout}
            style={{ color: '#ef4444', marginBottom: '0.5rem' }}
            title={isCollapsed ? "Cerrar Sesión" : ""}
          >
            <span className="sidebar-icon"><FiLogOut /></span>
            {!isCollapsed && <span className="sidebar-label">Cerrar Sesión</span>}
          </button>
        )}
      </div>
    </aside>
  );
};
