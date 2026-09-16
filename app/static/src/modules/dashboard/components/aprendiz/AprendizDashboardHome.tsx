import React, { useState, useEffect } from 'react';
import { FiBook, FiCalendar, FiClock, FiAlertTriangle, FiArrowRight } from 'react-icons/fi';

interface UserData {
  id?: number;
  name?: string;
  nombre?: string;
  display_name?: string;
  role?: { name: string };
  rol?: { nombre: string };
}

interface DashboardHomeProps {
  user: UserData;
  onNavigate: (section: string) => void;
}

export const AprendizDashboardHome: React.FC<DashboardHomeProps> = ({ user, onNavigate }) => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/v1/dashboard/aprendiz/stats', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (error) {
        console.error("Error fetching apprentice stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const summaryData = [
    { id: 'active-loans', title: 'Préstamos activos', value: stats?.metrics?.loans || 0, icon: <FiBook />, color: 'var(--sena-green)', section: 'loans' },
    { id: 'active-res', title: 'Reservas activas', value: stats?.metrics?.reservations || 0, icon: <FiCalendar />, color: '#8b5cf6', section: 'reservations' },
    { id: 'overdue', title: 'Préstamos vencidos', value: stats?.metrics?.overdue || 0, icon: <FiClock />, color: '#ef4444', section: 'loans' },
    { id: 'fines', title: 'Total de multas', value: stats?.metrics?.fines_count || 0, icon: <FiAlertTriangle />, color: '#f59e0b', section: 'loans' },
  ];

  const userName = (user.display_name || user.name || user.nombre || '').split(' ')[0] || 'Aprendiz';

  if (loading) {
    return <div className="loading-container">Cargando tu información...</div>;
  }

  return (
    <div className="dashboard-home-content">
      <div className="home-main-grid">
        <div className="home-left-column">
          {/* Hero Banner */}
          <div className="hero-banner-card">
            <div className="hero-banner-text">
              <h2>¡Hola, {userName}! 👋</h2>
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
              <img src="/assets/images/sena-avatar-v3.png" alt="Estudiante SENA" />
            </div>
          </div>

          {/* Resumen Personal */}
          <div className="summary-section">
            <h3>Mi resumen</h3>
            <div className="summary-grid">
              {summaryData.map(item => (
                <div
                  key={item.id}
                  className="summary-card"
                  role="button"
                  tabIndex={0}
                  onClick={() => onNavigate(item.section)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate(item.section); } }}
                >
                  <div className="summary-icon" style={{ color: item.color, backgroundColor: `${item.color}15` }}>
                    {item.icon}
                  </div>
                  <div className="summary-info">
                    <span className="summary-title">{item.title}</span>
                    <span className="summary-value" style={{ color: (item.id === 'overdue' && stats?.metrics?.overdue > 0) ? item.color : 'inherit' }}>
                      {item.value}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Préstamos Recientes / Próximos a Vencer */}
          <div className="featured-section">
            <div className="featured-header">
              <h3>Mis Préstamos Activos</h3>
              <button className="view-all-btn" onClick={() => onNavigate('loans')}>Ver todos <FiArrowRight /></button>
            </div>
            <div className="recent-activity-list">
              {stats?.active_loans?.length > 0 ? (
                stats.active_loans.map((loan: any) => (
                  <div key={loan.id} className="activity-item-card">
                    <div className="activity-item-icon"><FiBook /></div>
                    <div className="activity-item-details">
                      <h4>{loan.items}</h4>
                      <p>Vence el: {new Date(loan.due_date).toLocaleDateString()}</p>
                    </div>
                    <span className={`status-badge ${loan.status.toLowerCase()}`}>{loan.status}</span>
                  </div>
                ))
              ) : (
                <div className="empty-state-mini">
                  <FiBook size={32} />
                  <p>No tienes préstamos activos.</p>
                </div>
              )}
            </div>
          </div>

          {/* Reservas Pendientes */}
          <div className="featured-section">
            <div className="featured-header">
              <h3>Mis Reservas</h3>
              <button className="view-all-btn" onClick={() => onNavigate('reservations')}>Ver todas <FiArrowRight /></button>
            </div>
            <div className="recent-activity-list">
              {stats?.reservations?.length > 0 ? (
                stats.reservations.map((res: any) => (
                  <div key={res.id} className="activity-item-card">
                    <div className="activity-item-icon"><FiCalendar /></div>
                    <div className="activity-item-details">
                      <h4>{res.item_name}</h4>
                      <p>
                        {res.status === 'READY' 
                          ? `Expira el: ${new Date(res.expiration).toLocaleString()}` 
                          : 'En espera (Cola)'}
                      </p>
                    </div>
                    <span className={`status-badge ${res.status === 'READY' ? 'ready' : 'queued'}`}>
                      {res.status === 'READY' ? 'LISTA' : 'EN COLA'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty-state-mini">
                  <FiCalendar size={32} />
                  <p>No tienes reservas activas.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
