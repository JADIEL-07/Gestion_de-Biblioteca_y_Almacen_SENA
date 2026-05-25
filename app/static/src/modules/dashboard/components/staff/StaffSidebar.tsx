import React, { useState } from 'react';
import {
  FiHome, FiBox, FiBookOpen, FiSettings, FiHelpCircle,
  FiLogOut, FiMenu, FiEdit3
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';

interface StaffSidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  user: any;
  onLogout: () => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
  isMobileOpen?: boolean;
}

export const StaffSidebar: React.FC<StaffSidebarProps> = ({
  activeSection, onNavigate, user, onLogout,
  isCollapsed = false, onToggle, isMobileOpen = false
}) => {
  const roleName = (user?.role?.name || user?.rol?.nombre || 'STAFF').toUpperCase();
  const depName = user?.dependency_name || user?.dependency_obj?.name || '';

  const mainItems = [
    { id: 'home',      label: 'Inicio',                icon: <FiHome /> },
    { id: 'inventory', label: 'Mi Inventario',          icon: <FiBox /> },
    { id: 'loans',     label: 'Préstamos & Reservas',   icon: <FiBookOpen /> },
  ];

  const bottomItems = [
    { id: 'config', label: 'Configuración', icon: <FiSettings /> },
    { id: 'help',   label: 'Asistente personal', icon: <AnimatedRobotIcon /> },
  ];

  const initials = (user?.name || '??')
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside
      className={`admin-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
      style={{ maxHeight: '100vh' }}
    >
      {/* Header con toggle — igual al Admin */}
      <div className="admin-sidebar-header">
        <div style={{ display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '0.5rem 0' : '0.5rem 1rem' }}>
          <button className="admin-sidebar-toggle-box" onClick={onToggle}>
            <FiMenu style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.3s ease' }} />
          </button>
        </div>
      </div>

      {/* Badge de rol y dependencia */}
      {!isCollapsed && (
        <div style={{
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--admin-border-color, #2a374f)',
          background: 'rgba(57,169,0,0.05)',
          textAlign: 'center'
        }}>
          <div style={{ color: 'var(--sena-green, #39A900)', fontWeight: 800, fontSize: '0.85rem', letterSpacing: '1px' }}>
            {roleName}
          </div>
          {depName && (
            <div style={{ color: 'var(--admin-text-muted, #64748b)', fontSize: '0.75rem', marginTop: '0.2rem', textTransform: 'uppercase' }}>
              {depName}
            </div>
          )}
        </div>
      )}

      {/* Menú principal */}
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
            </div>
          </button>
        ))}

        <div style={{ height: '1.2rem' }} />

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

      <div style={{ flex: 1 }} />

      {/* Footer con avatar — igual al Admin */}
      <div className="admin-sidebar-footer" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ margin: '0.3rem 0', height: '1px', background: 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.4rem', marginTop: '0.4rem' }}>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: isCollapsed ? '34px' : '40px',
              height: isCollapsed ? '34px' : '40px',
              borderRadius: '50%',
              background: '#39a900',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold',
              fontSize: isCollapsed ? '0.8rem' : '0.9rem',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              overflow: 'hidden'
            }}>
              {user?.profile_image ? (
                <img src={user.profile_image} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : initials}
            </div>

            {!isCollapsed && (
              <div
                onClick={() => onNavigate('profile')}
                style={{
                  position: 'absolute', top: 0, right: '-2px',
                  background: 'var(--admin-profile-edit-bg)',
                  border: '1px solid var(--admin-border-color)',
                  color: 'var(--admin-profile-edit-text)',
                  width: '18px', height: '18px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.65rem', cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                }}
              >
                <FiEdit3 />
              </div>
            )}

            {!isCollapsed && (
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem', fontWeight: 600 }}>
                {roleName.charAt(0) + roleName.slice(1).toLowerCase()}
              </span>
            )}
          </div>
        </div>

        <button
          className="admin-sidebar-item logout-item"
          onClick={onLogout}
          style={{ color: '#ef4444' }}
          title={isCollapsed ? 'Cerrar Sesión' : ''}
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
