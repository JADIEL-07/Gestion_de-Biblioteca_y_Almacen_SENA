import React from 'react';
import { FiSearch, FiGrid, FiBook, FiCalendar, FiClock, FiAlertTriangle } from 'react-icons/fi';

interface UserData {
  id?: number;
  name?: string;
  nombre?: string;
  role?: { name: string };
  rol?: { nombre: string };
}

interface DashboardHomeProps {
  user: UserData;
  isGuest: boolean;
  isPendingUser: boolean;
  onNavigate: (section: string) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({ user, isGuest, isPendingUser, onNavigate }) => {
  const summaryData = [
    { id: 'active-loans', title: 'Préstamos activos', value: '--', icon: <FiBook />, color: 'var(--sena-green)' },
    { id: 'active-res', title: 'Reservas activas', value: '--', icon: <FiCalendar />, color: '#8b5cf6' },
    { id: 'overdue', title: 'Préstamos vencidos', value: '--', icon: <FiClock />, color: '#ef4444' },
    { id: 'fines', title: 'Multas pendientes', value: '--', icon: <FiAlertTriangle />, color: '#f59e0b' },
  ];

  const featuredItems: any[] = [];

  const handleAction = (action: string) => {
    if (isGuest) {
      alert(`Para ${action} debes iniciar sesión.`);
      return;
    }
    if (isPendingUser) {
      alert(`Para ${action} debes terminar de actualizar tus datos y tomar el rol de aprendiz.`);
      onNavigate('update');
      return;
    }
    alert(`Acción: ${action}`);
  };

  const currentRoleName = user.role?.name || user.rol?.nombre;
  const userName = isGuest ? 'Invitado' : (user.name || user.nombre || '').split(' ')[0];
  const userRoleStr = isGuest ? 'Invitado' : (currentRoleName === 'ADMIN' ? 'Administrador' : (currentRoleName === 'APRENDIZ' ? 'Aprendiz' : 'Usuario'));

  return (
    <div className="dashboard-home-content">
      {/* Barra de Búsqueda */}
      <div className="search-top-bar">
        <div className="search-input-wrapper">
          <input type="text" placeholder="Buscar libros, equipos, herramientas y más..." />
          <button className="search-btn"><FiSearch /></button>
        </div>
        <button className="explore-cat-btn">
          <FiGrid /> Explorar por categorías
        </button>
      </div>

      <div className="home-main-grid">
        <div className="home-left-column">
          {/* Hero Banner */}
          <div className="hero-banner-card">
            <div className="hero-banner-text">
              <h2>¡Hola, {userRoleStr}! 👋</h2>
              <h1>¿Qué necesitas hoy?</h1>
              <p>Explora el catálogo y solicita lo que necesites para tu formación.</p>
              <button 
                className="hero-explore-btn"
                onClick={() => onNavigate('explore')}
              >
                Explorar elementos
              </button>
            </div>
            <div className="hero-banner-img">
              {/* Imagen del chico enviada por el usuario */}
              <img src="/assets/images/sena-avatar-v3.png" alt="Estudiante SENA" />
            </div>
          </div>

          {/* Resumen Personal */}
          <div className="summary-section">
            <h3>Resumen personal</h3>
            <div className="summary-grid">
              {summaryData.map(item => (
                <div key={item.id} className="summary-card">
                  <div className="summary-icon" style={{ color: item.color, backgroundColor: `${item.color}15` }}>
                    {item.icon}
                  </div>
                  <div className="summary-info">
                    <span className="summary-title">{item.title}</span>
                    <span className="summary-value" style={{ color: item.value > 0 && item.color === '#ef4444' ? item.color : 'inherit' }}>
                      {item.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Elementos Destacados */}
          <div className="featured-section">
            <div className="featured-header">
              <h3>Elementos destacados</h3>
              <button className="view-all-btn">Ver todos &gt;</button>
            </div>
            <div className="featured-grid">
              {featuredItems.map(item => (
                <div key={item.id} className="featured-card">
                  <span className={`status-badge ${item.statusColor}`}>{item.status}</span>
                  <div className="featured-img-container">
                    <img src={item.img} alt={item.title} />
                  </div>
                  <div className="featured-details">
                    <h4>{item.title}</h4>
                    <p>{item.category}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* La columna derecha ha sido eliminada por solicitud del usuario */}
      </div>
    </div>
  );
};
