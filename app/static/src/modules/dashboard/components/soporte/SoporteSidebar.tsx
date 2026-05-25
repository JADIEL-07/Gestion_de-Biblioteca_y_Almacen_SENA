import React from 'react';
import {
  FiHome, FiAlertCircle, FiTool, FiMonitor, FiClipboard, FiBox, FiClock, FiFileText,
  FiMessageSquare, FiCalendar, FiSettings, FiLogOut, FiMenu, FiUsers, FiMaximize, FiEdit3,
  FiHeadphones
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';
import '../admin/AdminDashboard.css';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  role?: { name: string };
  rol?: { nombre: string };
  profile_image?: string;
}

interface SoporteSidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  user: UserData;
  onLogout: () => void;
  isCollapsed: boolean;
  onToggle: () => void;
  isMobileOpen: boolean;
}

export const SoporteSidebar: React.FC<SoporteSidebarProps> = ({
  activeSection,
  onNavigate,
  user,
  onLogout,
  isCollapsed = false,
  onToggle,
  isMobileOpen = false
}) => {
  const mainItems = [
    { id: 'dashboard', label: 'Inicio', icon: <FiHome /> },
    { id: 'incidencias', label: 'Reportes de Fallas', icon: <FiAlertCircle /> },
    { id: 'mantenimientos', label: 'Área de Trabajo', icon: <FiTool /> },
    { id: 'repuestos', label: 'Repuestos', icon: <FiBox /> },
    { id: 'historial', label: 'Historial técnico', icon: <FiClock /> },
    { id: 'solicitudes', label: 'Solicitudes (Aprendices)', icon: <FiHeadphones /> },
    { id: 'staff-chat', label: 'Chat Interno', icon: <FiUsers /> },
  ];

  const bottomItems = [
    { id: 'config', label: 'Configuración', icon: <FiSettings /> },
    { id: 'help', label: 'Asistente personal', icon: <AnimatedRobotIcon /> },
  ];

  return (
    <aside className={`admin-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
      <div className="admin-sidebar-header">
        <div style={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '0.5rem 0' : '0.5rem 1rem 0.5rem 1rem' }}>
          <button 
            className="admin-sidebar-toggle-box" 
            onClick={onToggle}
          >
            <FiMenu style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s ease' }} />
          </button>
        </div>
      </div>

      <div className="admin-sidebar-menu" style={{ gap: '0.1rem' }}>
        {mainItems.map(item => (
          <button
            key={item.id}
            className={`admin-sidebar-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={isCollapsed ? item.label : ''}
          >
            <div className="admin-sidebar-item-content">
              <span className="admin-sidebar-icon">{item.icon}</span>
              <span className="admin-sidebar-label">{item.label}</span>
              {!isCollapsed && item.badge && (
                <span style={{ 
                  background: item.badgeColor === 'red' ? '#ef4444' : item.badgeColor === 'green' ? 'var(--sena-green, #39A900)' : item.badgeColor === 'purple' ? '#a855f7' : '#3b82f6', 
                  color: 'white', 
                  padding: '2px 6px', 
                  borderRadius: '10px', 
                  fontSize: '0.65rem', 
                  fontWeight: 'bold',
                  marginLeft: 'auto'
                }}>
                  {item.badge}
                </span>
              )}
            </div>
          </button>
        ))}

      </div>

      <div className="admin-sidebar-spacer"></div>

      <div className="admin-sidebar-bottom">
        {bottomItems.map(item => (
          <button
            key={item.id}
            className={`admin-sidebar-item ${activeSection === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={isCollapsed ? item.label : ''}
          >
            <div className="admin-sidebar-item-content">
              <span className="admin-sidebar-icon">{item.icon}</span>
              <span className="admin-sidebar-label">{item.label}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="admin-sidebar-footer" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ margin: '0.3rem 0', height: '1px', background: 'rgba(255,255,255,0.1)', opacity: 0.1 }}></div>

        {/* PERFIL VERTICAL CENTRADO CON ICONO FLOTANTE PARA SOPORTE */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.4rem', marginTop: '0.4rem' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: isCollapsed ? '34px' : '40px',
              height: isCollapsed ? '34px' : '40px',
              borderRadius: '50%',
              background: 'var(--sena-green, #39A900)', // SENA Green matching main theme
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: isCollapsed ? '0.8rem' : '0.9rem',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              overflow: 'hidden'
            }}>
              {user.profile_image ? (
                <img src={user.profile_image} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                (user.name || user.nombre || 'ST').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
              )}
            </div>
            
            {/* Lápiz flotante */}
            {!isCollapsed && (
              <div 
                onClick={() => onNavigate('profile')}
                style={{
                  position: 'absolute',
                  top: '0',
                  right: '-2px',
                  background: 'var(--admin-profile-edit-bg, #334155)',
                  border: '1px solid var(--admin-border-color, #475569)',
                  color: 'var(--admin-profile-edit-text, #f8fafc)',
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
              <span style={{ fontSize: '0.75rem', color: 'var(--soporte-text-muted, #64748b)', marginTop: '0.2rem', fontWeight: 600 }}>Soporte Técnico</span>
            )}
          </div>
        </div>

        <button
          className="admin-sidebar-item logout-item"
          onClick={onLogout}
          style={{ color: '#ef4444' }}
          title={isCollapsed ? "Cerrar Sesión" : ""}
        >
          <div className="admin-sidebar-item-content">
            <span className="admin-sidebar-icon"><FiLogOut /></span>
            <span className="admin-sidebar-label">Cerrar Sesión</span>
          </div>
        </button>
      </div>
    </aside>
  );
};
