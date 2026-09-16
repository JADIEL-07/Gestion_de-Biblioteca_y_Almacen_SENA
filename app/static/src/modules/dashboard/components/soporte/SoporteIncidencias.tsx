import React, { useState, useEffect, useMemo } from 'react';
import { alertDialog } from '../../../../components/ui/ConfirmDialog';
import { FiAlertCircle, FiCheck, FiClock, FiUser, FiActivity, FiBriefcase, FiList, FiFileText, FiSearch } from 'react-icons/fi';
import './SoporteIncidencias.css';

interface Incident {
  id: number;
  subject: string;
  description: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  reported_by: string;
  support_person: string;
  created_at: string;
}

interface SoporteIncidenciasProps {
  user: any;
}

export const SoporteIncidencias: React.FC<SoporteIncidenciasProps> = ({ user }) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'todos' | 'pendientes' | 'mis_casos'>('todos');
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('Todas las categorías');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchIncidents = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/reports_mgmt/all_incidents', {
        headers: { 'Authorization': `Bearer {token}`.replace('{token}', token || '') }
      });
      if (response.ok) {
        setIncidents(await response.json());
      }
    } catch (error) {
      console.error("Error fetching all incidents:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  const handleTakeCase = async (id: number) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/v1/reports_mgmt/${id}/take`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        alertDialog("¡Has tomado el caso con éxito!");
        setLoading(true);
        await fetchIncidents();
      } else {
        const err = await res.json();
        alertDialog(err.error || "No se pudo tomar el caso.");
      }
    } catch (error) {
      console.error("Error taking case:", error);
      alertDialog("Error de conexión al tomar el caso.");
    }
  };

  const getSeverityBadge = (sev: string) => {
    const s = sev.toUpperCase();
    if (s === 'LOW') return <span className="severity-badge low">Baja</span>;
    if (s === 'MEDIUM') return <span className="severity-badge medium">Media</span>;
    if (s === 'HIGH') return <span className="severity-badge high">Alta</span>;
    return <span className="severity-badge critical">Crítica</span>;
  };

  const getStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    if (s === 'OPEN') return <span style={{ color: '#3b82f6', background: 'rgba(59, 130, 246, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Abierto</span>;
    if (s === 'IN_PROGRESS') return <span style={{ color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>En Progreso</span>;
    return <span style={{ color: '#39A900', background: 'rgba(57, 169, 0, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Resuelto</span>;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  };

  const userName = user.name || user.nombre || "Soporte Técnico";

  const stats = useMemo(() => {
    return {
      total: incidents.length,
      pending: incidents.filter(i => i.support_person === 'Pendiente').length,
      mine: incidents.filter(i => i.support_person === userName).length,
      critical: incidents.filter(i => i.severity === 'CRITICAL' && i.status !== 'RESOLVED' && i.status !== 'CLOSED').length
    };
  }, [incidents, userName]);

  const filteredIncidents = useMemo(() => {
    let filtered = [...incidents];
    if (activeTab === 'pendientes') {
      filtered = filtered.filter(i => i.support_person === 'Pendiente');
    } else if (activeTab === 'mis_casos') {
      filtered = filtered.filter(i => i.support_person === userName);
    }
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(i => 
        i.subject.toLowerCase().includes(term) ||
        i.reported_by.toLowerCase().includes(term) ||
        i.id.toString().includes(term)
      );
    }

    if (dateFrom) {
      filtered = filtered.filter(i => new Date(i.created_at) >= new Date(dateFrom));
    }
    if (dateTo) {
      filtered = filtered.filter(i => new Date(i.created_at) <= new Date(dateTo));
    }

    return filtered;
  }, [incidents, activeTab, userName, searchTerm, dateFrom, dateTo]);

  const clearFilters = () => {
    setSearchTerm('');
    setCategoryFilter('Todas las categorías');
    setDateFrom('');
    setDateTo('');
  };

  return (
    <div className="incidencias-container fade-in">
      <div className="incidencias-header-section">
        <h1>Bandeja de Reportes</h1>
        <p>Bandeja unificada con todos los reportes de soporte técnico de la sede hechos por los aprendices.</p>

        {/* SUMMARY STATS GRID */}
        <div className="admin-horizontal-stats">
          <div className="admin-stat-box">
            <div className="admin-stat-icon green">
              <FiFileText size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">TOTAL REPORTES</p>
              <h3 className="admin-stat-value">{stats.total}</h3>
            </div>
          </div>
          <div className="admin-stat-box">
            <div className="admin-stat-icon blue">
              <FiActivity size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">CASOS ABIERTOS</p>
              <h3 className="admin-stat-value">{stats.pending}</h3>
            </div>
          </div>
          <div className="admin-stat-box">
            <div className="admin-stat-icon red">
              <FiAlertCircle size={22} />
            </div>
            <div className="admin-stat-info">
              <p className="admin-stat-title">URGENCIA CRÍTICA</p>
              <h3 className="admin-stat-value">{stats.critical}</h3>
            </div>
          </div>
        </div>

        {/* FILTERS */}
        <div className="admin-filter-section">
          <div className="admin-filter-row">
            <div className="admin-filter-group flex-2">
              <label>BÚSQUEDA RÁPIDA</label>
              <div className="admin-input-icon">
                <FiSearch className="icon" />
                <input 
                  type="text" 
                  placeholder="Asunto, usuario o ID..." 
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="admin-filter-group flex-1">
              <label>CATEGORÍA DEL REPORTE</label>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <option>Todas las categorías</option>
              </select>
            </div>
          </div>
          <div className="admin-filter-row">
            <div className="admin-filter-group flex-1">
              <label>DESDE (FECHA)</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="admin-filter-group flex-1">
              <label>HASTA (FECHA)</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="admin-filter-group-btn">
              <button className="admin-btn-clear" onClick={clearFilters}>Limpiar Filtros</button>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="incidencias-tabs">
          <button
            className={`incidencias-tab-btn ${activeTab === 'todos' ? 'active' : ''}`}
            onClick={() => setActiveTab('todos')}
          >
            Todos los Reportes
          </button>
          <button
            className={`incidencias-tab-btn ${activeTab === 'pendientes' ? 'active' : ''}`}
            onClick={() => setActiveTab('pendientes')}
          >
            Pendientes
          </button>
          <button
            className={`incidencias-tab-btn ${activeTab === 'mis_casos' ? 'active' : ''}`}
            onClick={() => setActiveTab('mis_casos')}
          >
            Mis Casos
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner-container">
          <div className="spinner"></div>
          <p>Cargando incidencias...</p>
        </div>
      ) : filteredIncidents.length === 0 ? (
        <div className="incidencias-empty-state">
          <FiActivity size={48} style={{ color: '#64748b' }} />
          <p>No se encontraron incidencias en esta sección.</p>
        </div>
      ) : (
        <div className="incidencias-table-wrapper">
          <table className="incidencias-table">
            <thead>
              <tr>
                <th>Elemento / Asunto</th>
                <th>Reportado por</th>
                <th>Fecha de Reporte</th>
                <th>Gravedad</th>
                <th>Estado</th>
                <th>Atendido por</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredIncidents.map((inc) => (
                <tr key={inc.id}>
                  <td data-label="Elemento" className="item-col">
                    <span style={{ color: 'var(--admin-text-primary)', fontWeight: 600 }}>{inc.subject}</span>
                  </td>
                  <td data-label="Reportado por">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <FiUser size={14} style={{ color: 'var(--admin-text-muted)' }} />
                      <span>{inc.reported_by}</span>
                    </div>
                  </td>
                  <td data-label="Fecha de Reporte">
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ color: 'var(--admin-text-primary)' }}>{formatDate(inc.created_at).split(' ')[0]}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--admin-text-muted)' }}>{formatDate(inc.created_at).split(' ').slice(1).join(' ')}</span>
                    </div>
                  </td>
                  <td data-label="Gravedad">{getSeverityBadge(inc.severity)}</td>
                  <td data-label="Estado">{getStatusBadge(inc.status)}</td>
                  <td data-label="Atendido por">
                    <span style={{ color: inc.support_person === 'Pendiente' ? 'var(--admin-text-muted)' : '#39A900', fontWeight: inc.support_person === 'Pendiente' ? 400 : 600 }}>
                      {inc.support_person}
                    </span>
                  </td>
                  <td data-label="Acciones">
                    {inc.support_person === 'Pendiente' ? (
                      <button className="btn-take-case" onClick={() => handleTakeCase(inc.id)}>
                        <FiCheck size={16} /> Tomar caso
                      </button>
                    ) : inc.support_person === userName ? (
                      <span className="btn-my-case-active" style={{ background: '#2563eb' }}>
                        <FiClock size={16} /> Asignado a mí
                      </span>
                    ) : (
                      <span className="btn-my-case-active" style={{ background: '#475569', cursor: 'default' }}>
                        Asignado
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
