import React from 'react';
import { 
  FiAlertCircle, FiTool, FiMonitor, FiClipboard, FiBox, 
  FiArrowRight, FiAlertTriangle, FiInfo, FiUserCheck
} from 'react-icons/fi';
import './SoporteDashboard.css';

interface UserData {
  id: number;
  name?: string;
  nombre?: string;
}

interface SoporteHomeProps {
  user: UserData;
}

export const SoporteHome: React.FC<SoporteHomeProps> = ({ user }) => {
  const firstName = (user.name || user.nombre || 'Soporte Técnico').split(' ')[0];

  return (
    <div className="soporte-home fade-in">
      <div className="sh-header">
        <div className="sh-header-text">
          <h1>¡Hola, {firstName}!👋</h1>
          <p>Aquí tienes un resumen del estado técnico de la sede.</p>
        </div>
      </div>

      <div className="sh-stats-grid">
        <div className="sh-stat-card">
          <div className="sh-stat-info">
            <span className="sh-stat-title">Incidencias abiertas</span>
            <span className="sh-stat-value">--</span>
          </div>
          <div className="sh-stat-icon-wrapper blue">
            <FiAlertCircle />
          </div>
        </div>

        <div className="sh-stat-card">
          <div className="sh-stat-info">
            <span className="sh-stat-title">En mantenimiento</span>
            <span className="sh-stat-value">--</span>
          </div>
          <div className="sh-stat-icon-wrapper orange">
            <FiTool />
          </div>
        </div>

        <div className="sh-stat-card">
          <div className="sh-stat-info">
            <span className="sh-stat-title">Equipos operativos</span>
            <span className="sh-stat-value">--</span>
          </div>
          <div className="sh-stat-icon-wrapper green">
            <FiMonitor />
          </div>
        </div>

        <div className="sh-stat-card">
          <div className="sh-stat-info">
            <span className="sh-stat-title">Órdenes de trabajo</span>
            <span className="sh-stat-value">--</span>
          </div>
          <div className="sh-stat-icon-wrapper purple">
            <FiClipboard />
          </div>
        </div>

        <div className="sh-stat-card">
          <div className="sh-stat-info">
            <span className="sh-stat-title">Repuestos en stock bajo</span>
            <span className="sh-stat-value">--</span>
          </div>
          <div className="sh-stat-icon-wrapper yellow">
            <FiBox />
          </div>
        </div>
      </div>

      <div className="sh-bottom-grid">
        <div className="sh-panel alerts-panel">
          <div className="sh-panel-header flex-between">
            <h3>Alertas importantes</h3>
          </div>
          <div className="sh-empty-list">
            <FiInfo size={28} />
            <p>No hay alertas por mostrar</p>
          </div>
        </div>
      </div>

      <div className="sh-bottom-grid-3">
        <div className="sh-panel">
          <div className="sh-panel-header">
            <h3>Estado de equipos</h3>
          </div>
          <div className="sh-empty-chart">
            <FiMonitor size={32} />
            <p>No hay datos disponibles</p>
          </div>
        </div>

        <div className="sh-panel">
          <div className="sh-panel-header flex-between">
            <h3>Actividad técnica reciente</h3>
          </div>
          <div className="sh-empty-list">
            <FiUserCheck size={28} />
            <p>No hay actividad registrada</p>
          </div>
        </div>
      </div>
    </div>
  );
};
