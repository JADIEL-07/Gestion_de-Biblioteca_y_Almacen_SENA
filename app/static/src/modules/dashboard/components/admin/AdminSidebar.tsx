import React, { useState } from 'react';
import {
  FiHome, FiBox, FiBook, FiCalendar, FiTool,
  FiArrowRightCircle, FiBarChart2, FiUsers,
  FiSettings, FiShield, FiHelpCircle, FiChevronDown, FiLogOut, FiMenu, FiEdit3, FiPackage, FiActivity,
  FiList, FiMapPin, FiLayers, FiHeadphones
} from 'react-icons/fi';
import { AnimatedRobotIcon } from '../../../../components/ui/AnimatedRobotIcon';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
  role?: { name: string };
  rol?: { nombre: string };
  profile_image?: string;
}

interface AdminSidebarProps {
  activeSection: string;
  onNavigate: (section: string) => void;
  user: UserData;
  onLogout: () => void;
  isCollapsed?: boolean;
  onToggle?: () => void;
  isMobileOpen?: boolean;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  activeSection,
  onNavigate,
  user,
  onLogout,
  isCollapsed = false,
  onToggle,
  isMobileOpen = false
}) => {
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const mainItems = [
    { id: 'dashboard', label: 'Inicio', icon: <FiHome /> },
    { 
      id: 'inventory', 
      label: 'Inventario', 
      icon: <FiBox />,
      hasDropdown: true,
      subItems: [
        { id: 'inventory-table', label: 'Tabla de inventario', icon: <FiList /> },
        { id: 'inventory-locations', label: 'Ubicación', icon: <FiMapPin /> },
        { id: 'inventory-categories', label: 'Categorías', icon: <FiLayers /> },
      ]
    },
    { id: 'loans', label: 'Préstamos', icon: <FiBook /> },
    { id: 'reservations', label: 'Reservas', icon: <FiCalendar /> },
    { id: 'maintenance', label: 'Mantenimiento', icon: <FiTool /> },
    { id: 'exits', label: 'Salidas', icon: <FiArrowRightCircle /> },
    { id: 'reports', label: 'Reportes', icon: <FiBarChart2 /> },
    { id: 'users', label: 'Usuarios', icon: <FiUsers /> },
  ];

  const adminBottomItems = [
    { id: 'solicitudes', label: 'Solicitudes', icon: <FiHeadphones /> },
    { id: 'config', label: 'Configuración', icon: <FiSettings /> },
    { id: 'audit', label: 'Auditoría', icon: <FiShield /> },
    { id: 'help', label: 'Asistente personal', icon: <AnimatedRobotIcon /> },
  ];

  const handleItemClick = (item: any) => {
    if (item.hasDropdown && !isCollapsed) {
      toggleExpand(item.id);
    } else {
      onNavigate(item.id);
    }
  };

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
          <React.Fragment key={item.id}>
            <button
              className={`admin-sidebar-item ${activeSection === item.id || (item.subItems?.some(s => s.id === activeSection)) ? 'active' : ''}`}
              onClick={() => handleItemClick(item)}
              title={isCollapsed ? item.label : ''}
            >
              <div className="admin-sidebar-item-content">
                <span className="admin-sidebar-icon">{item.icon}</span>
                <span className="admin-sidebar-label">{item.label}</span>
              </div>
              {item.hasDropdown && !isCollapsed && (
                <FiChevronDown 
                  style={{ 
                    fontSize: '0.8rem',
                    transition: 'transform 0.3s', 
                    transform: expandedItems.includes(item.id) ? 'rotate(180deg)' : 'rotate(0)' 
                  }} 
                />
              )}
            </button>
            
            {item.hasDropdown && !isCollapsed && expandedItems.includes(item.id) && (
              <div style={{ paddingLeft: '1.2rem' }}>
                {item.subItems?.map(sub => (
                  <button
                    key={sub.id}
                    className={`admin-sidebar-item sub-item ${activeSection === sub.id ? 'active' : ''}`}
                    onClick={() => onNavigate(sub.id)}
                    style={{ height: '32px', fontSize: '0.8rem', padding: '0 0.8rem' }}
                  >
                    <div className="admin-sidebar-item-content" style={{ gap: '0.5rem' }}>
                      <span className="admin-sidebar-icon" style={{ fontSize: '0.85rem' }}>{sub.icon}</span>
                      <span className="admin-sidebar-label">{sub.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}

      </div>

      <div className="admin-sidebar-spacer"></div>

      <div className="admin-sidebar-bottom">
        {adminBottomItems.map(item => (
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

        {/* PERFIL VERTICAL CENTRADO CON ICONO FLOTANTE PARA ADMIN */}
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
              {user.profile_image ? (
                <img src={user.profile_image} alt="Avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                (user.name || user.nombre || 'AD').split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
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
                  background: 'var(--admin-profile-edit-bg)',
                  border: '1px solid var(--admin-border-color)',
                  color: 'var(--admin-profile-edit-text)',
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
              <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem', fontWeight: 600 }}>Administrador</span>
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
