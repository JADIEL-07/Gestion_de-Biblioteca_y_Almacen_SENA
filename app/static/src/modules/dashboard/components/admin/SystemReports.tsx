import React, { useState, useEffect } from 'react';
import { 
  FiBarChart2, FiUser, FiHeadphones, FiAlertCircle, FiClock, 
  FiSearch, FiFilter, FiFileText, FiActivity, FiPackage, FiCalendar 
} from 'react-icons/fi';
import './SystemReports.css';

interface Report {
  id: number;
  subject: string;
  description: string;
  severity: string;
  status: string;
  reported_by: string;
  support_person: string;
  created_at: string;
  photo?: string;
}

export const SystemReports: React.FC = () => {
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState({ total: 0, open: 0, critical: 0 });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const categories = ['GENERAL', 'TECNICO', 'SISTEMA'];

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: searchTerm,
        startDate: startDate,
        endDate: endDate
      });
      const [rData, sData] = await Promise.all([
        fetch(`/api/v1/reports_mgmt/?${params.toString()}`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.json()),
        fetch('/api/v1/reports_mgmt/stats', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        }).then(r => r.json())
      ]);
      // La API puede devolver {error: ...} en vez de un array (401, 403, 500);
      // sin este guard, reports.filter(...) revienta toda la vista.
      setReports(Array.isArray(rData) ? rData : []);
      setStats(sData && typeof sData.total === 'number' ? sData : { total: 0, open: 0, critical: 0 });
    } catch (error) {
      console.error('Error fetching reports:', error);
      setReports([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [searchTerm, startDate, endDate]);

  const getSeverityClass = (sev: string) => {
    switch(sev) {
      case 'CRITICAL': return 'sev-critical';
      case 'HIGH': return 'sev-high';
      case 'MEDIUM': return 'sev-medium';
      default: return 'sev-low';
    }
  };

  const filteredReports = reports.filter(r => {
    const s = searchTerm.toLowerCase();
    const reportDate = new Date(r.created_at);
    
    const matchesSearch =
      (r.subject || '').toLowerCase().includes(s) ||
      (r.reported_by || '').toLowerCase().includes(s) ||
      r.id.toString().includes(searchTerm);
    
    const start = startDate ? new Date(startDate + 'T00:00:00') : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;
    let matchesDate = true;
    if (start && reportDate < start) matchesDate = false;
    if (end && reportDate > end) matchesDate = false;
    
    return matchesSearch && matchesDate;
  });

  return (
    <div className="reports-mgmt-container fade-in">
      {/* MÉTRICAS */}
      <div className="reports-stats-grid">
        <div className="report-stat-card">
          <FiFileText className="stat-icon" />
          <div className="stat-content">
            <span className="label">Total Reportes</span>
            <span className="value">{stats.total}</span>
          </div>
        </div>
        <div className="report-stat-card">
          <FiActivity className="stat-icon open" />
          <div className="stat-content">
            <span className="label">Casos Abiertos</span>
            <span className="value">{stats.open}</span>
          </div>
        </div>
        <div className="report-stat-card">
          <FiAlertCircle className="stat-icon critical" />
          <div className="stat-content">
            <span className="label">Urgencia Crítica</span>
            <span className="value">{stats.critical}</span>
          </div>
        </div>
      </div>

      {/* FILTROS COMPLEJOS */}
      <div className="loan-filters-complex">
        <div className="filter-row">
          <div className="filter-item search">
            <label>BÚSQUEDA RÁPIDA</label>
            <div className="input-with-icon">
              <FiSearch />
              <input 
                type="text" 
                placeholder="Asunto, usuario o ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <label>CATEGORÍA DEL REPORTE</label>
            <div className="input-with-icon">
              <FiPackage />
              <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
                <option value="ALL">Todas las categorias</option>
                <option value="GENERAL">General</option>
                <option value="TECNICO">Técnico</option>
                <option value="SISTEMA">Sistema</option>
              </select>
            </div>
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-item">
            <label>DESDE (FECHA)</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <label>HASTA (FECHA)</label>
            <div className="input-with-icon">
              <FiCalendar />
              <input 
                type="date" 
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          
          <div className="filter-item-actions">
            <button className="btn-reset" onClick={() => {
              setStartDate('');
              setEndDate('');
              setFilterCategory('ALL');
              setSearchTerm('');
            }}>Limpiar Filtros</button>
          </div>
        </div>
      </div>

      {/* TABLA */}
      <div className="reports-table-wrapper">
        <table className="reports-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Reportado por</th>
              <th>Soporte (Asignado)</th>
              <th>Descripción / Asunto</th>
              <th>Gravedad</th>
              <th>Fecha Reporte</th>
              <th>Estado</th>
              <th>Adjuntos</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="td-center">Cargando reportes del sistema...</td></tr>
            ) : filteredReports.length === 0 ? (
              <tr><td colSpan={8} className="td-center">No hay reportes para los filtros seleccionados.</td></tr>
            ) : filteredReports.map(report => (
              <tr key={report.id}>
                <td><span className="id-badge">#{report.id}</span></td>
                <td>
                  <div className="user-cell">
                    <FiUser className="cell-icon" />
                    <span>{report.reported_by}</span>
                  </div>
                </td>
                <td>
                  <div className="user-cell support">
                    <FiHeadphones className="cell-icon" />
                    <span>{report.support_person}</span>
                  </div>
                </td>
                <td>
                  <div className="desc-cell">
                    <strong>{report.subject}</strong>
                    <p>{report.description}</p>
                  </div>
                </td>
                <td>
                  <span className={`severity-pill ${getSeverityClass(report.severity)}`}>
                    {report.severity}
                  </span>
                </td>
                <td className="date-cell">
                  <FiClock className="small-icon" />
                  {report.created_at ? new Date(report.created_at).toLocaleDateString() : '—'}
                </td>
                <td>
                  <span className={`status-tag ${(report.status || '').toLowerCase()}`}>
                    {report.status || '—'}
                  </span>
                </td>
                <td>
                  {report.photo ? (
                    <img
                      src={report.photo}
                      alt="Adjunto"
                      onClick={() => window.open(report.photo, '_blank')}
                      title="Ver adjunto completo"
                      style={{ cursor: 'pointer', width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--admin-border-color)' }}
                    />
                  ) : (
                    <span style={{color: 'var(--admin-text-muted)', fontSize: '0.8rem'}}>Sin adjunto</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
