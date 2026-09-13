import React, { useState, useEffect } from 'react';
import { 
  FiChevronDown, FiClock, FiUser, FiMapPin, 
  FiBox, FiUploadCloud, FiCheckCircle, FiServer, FiPhone
} from 'react-icons/fi';
import './MaintenanceManagement.css';

interface ActiveCase {
  id: number;
  item_name: string;
  item_category?: string;
  item_id: number;
  reported_by_name: string;
  reported_by_email: string;
  technician_name: string;
  technician_email: string;
  item_code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  report_date: string;
  maintenance_type: string;
  cost: number;
  evidence_photo?: string;
  failure_description?: string;
}

export const MaintenanceManagement: React.FC = () => {
  const [allCases, setAllCases] = useState<ActiveCase[]>([]);
  const [activeCase, setActiveCase] = useState<ActiveCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [evidencePhotoBase64, setEvidencePhotoBase64] = useState<string>('');

  const handleStatusChange = async (newStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') => {
    if (!activeCase) return;
    setUpdating(true);
    try {
      const response = await fetch(`/api/v1/maintenance/${activeCase.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ status: newStatus })
      });
      if (response.ok) {
        setShowStatusDropdown(false);
        await fetchData();
      } else {
        const err = await response.json();
        alert(err.error || "No se pudo actualizar el estado.");
      }
    } catch (error) {
      console.error("Error updating status:", error);
      alert("Error de conexión al actualizar el estado.");
    } finally {
      setUpdating(false);
    }
  };

  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [diagnosis, setDiagnosis] = useState('');
  const [solution, setSolution] = useState('');
  const [cost, setCost] = useState('0');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setEvidencePhotoBase64(ev.target?.result as string);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleOpenCompleteModal = () => {
    setDiagnosis('');
    setSolution('');
    setCost('0');
    setEvidencePhotoBase64('');
    setShowCompleteModal(true);
  };

  const handleCompleteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCase) return;

    setUpdating(true);
    try {
      const response = await fetch(`/api/v1/maintenance/${activeCase.id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ 
          diagnosis, 
          solution, 
          cost: parseFloat(cost) || 0,
          evidence_photo: evidencePhotoBase64
        })
      });
      if (response.ok) {
        setShowCompleteModal(false);
        alert("¡Caso finalizado con éxito!");
        await fetchData();
      } else {
        alert("No se pudo finalizar el caso.");
      }
    } catch (error) {
      console.error("Error completing case:", error);
      alert("Error de conexión al finalizar el caso.");
    } finally {
      setUpdating(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/maintenance/', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (response.ok) {
        const data = await response.json();
        setAllCases(data);
        // Filtrar el primer caso que requiera atención
        const pendingCase = data.find((r: ActiveCase) => r.status === 'IN_PROGRESS' || r.status === 'PENDING');
        setActiveCase(pendingCase || null);
      }
    } catch (error) {
      console.error('Error fetching maintenance:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="maint-mgmt-container fade-in">
        <div className="at-empty">
          <div className="spinner" style={{ width: '40px', height: '40px', borderTopColor: 'var(--sena-green)' }}></div>
          <h2 style={{ marginTop: '1rem' }}>Cargando Área de Trabajo...</h2>
        </div>
      </div>
    );
  }

  if (!activeCase) {
    return (
      <div className="maint-mgmt-container fade-in">
        <div className="at-empty">
          <FiCheckCircle size={64} color="var(--sena-green)" />
          <h2>No tienes casos activos</h2>
          <p>Ve a la Bandeja de Reportes para asignarte un nuevo caso.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="maint-mgmt-container fade-in">
      {/* Header */}
      <div className="at-header-row">
        <div className="at-header-left">
          <h5>Caso Activo</h5>
          <div className="at-incident-id">
            INC-{new Date().getFullYear()}-0{activeCase.id} 
            {activeCase.severity === 'CRITICAL' && <span className="at-badge-critical">CRÍTICA</span>}
          </div>
          <h1>{activeCase.item_name} reporta falla</h1>
          
          <div className="at-header-tags">
            <div className="at-tag">
              <span className="at-tag-label"><FiClock size={14} /> Estado</span>
              <span className="at-tag-value">
                <div className={`at-status-dot ${activeCase.status.toLowerCase()}`}></div> 
                {activeCase.status === 'IN_PROGRESS' ? 'En reparación' : 
                 activeCase.status === 'PENDING' ? 'Pendiente de revisión' : 
                 activeCase.status === 'CANCELLED' ? 'Cancelado' : 'Completado'}
              </span>
            </div>
            <div className="at-tag">
              <span className="at-tag-label"><FiClock size={14} /> Reportado el</span>
              <span className="at-tag-value">{new Date(activeCase.report_date).toLocaleDateString()}</span>
            </div>
            <div className="at-tag">
              <span className="at-tag-label"><FiUser size={14} /> Responsable</span>
              <span className="at-tag-value">{activeCase.technician_name || 'Sin asignar'}</span>
            </div>
            <div className="at-tag">
              <span className="at-tag-label"><FiMapPin size={14} /> Ubicación</span>
              <span className="at-tag-value">SENA Sede Principal</span>
            </div>
          </div>
        </div>

      </div>

      <div className="at-main-grid">
        {/* LEFT COLUMN */}
        <div className="at-left-col">
          <div className="at-card">
            <div className="at-section">
              <h3 className="at-card-title">Descripción del incidente</h3>
              <p className="at-desc-text">
                El usuario {activeCase.reported_by_name} reportó un problema con el equipo {activeCase.item_name} (Código: {activeCase.item_code}). 
                La falla está categorizada como {activeCase.severity}. Se requiere revisión técnica en la ubicación especificada.
              </p>
            </div>

            <div className="at-section" style={{ marginTop: '1rem' }}>
              <h3 className="at-card-title">Línea de tiempo</h3>
              <div className="at-timeline">
                <div className="at-timeline-item">
                  <div className="at-timeline-icon red"><FiClock size={10} /></div>
                  <div className="at-timeline-content">
                    <div className="at-timeline-header">
                      <span className="at-timeline-time">{new Date(activeCase.report_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                      <span className="at-timeline-title">Reporte recibido</span>
                    </div>
                    <span className="at-timeline-desc">El usuario reportó la falla del elemento en el sistema.</span>
                  </div>
                </div>
                {activeCase.status === 'IN_PROGRESS' && (
                  <div className="at-timeline-item">
                    <div className="at-timeline-icon blue"><FiCheckCircle size={10} /></div>
                    <div className="at-timeline-content">
                      <div className="at-timeline-header">
                        <span className="at-timeline-time">Caso Activo</span>
                        <span className="at-timeline-title">Diagnóstico iniciado</span>
                      </div>
                      <span className="at-timeline-desc">Se inicia verificación y revisión del equipo afectado.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="at-section" style={{ marginTop: '1rem' }}>
              <h3 className="at-card-title">Notas técnicas</h3>
              <div className="at-note-input-row">
                <input type="text" className="at-note-input" placeholder="Agregar una nota técnica..." />
                <button className="at-btn-green">Guardar nota</button>
              </div>
            </div>

            <div className="at-section" style={{ marginTop: '1rem' }}>
              <h3 className="at-card-title">Evidencias</h3>
              <div className="at-evidences-grid">
                <div className="at-upload-box">
                  <FiUploadCloud size={24} />
                  <span>Subir archivo</span>
                </div>
              </div>
            </div>

            <div className="at-card-footer">
              <div className="at-dropdown-container">
                <button 
                  className="at-btn-dropdown" 
                  onClick={() => setShowStatusDropdown(!showStatusDropdown)}
                  disabled={updating}
                >
                  Cambiar estado <FiChevronDown style={{ marginLeft: '0.5rem' }} />
                </button>
                {showStatusDropdown && (
                  <div className="at-dropdown-menu">
                    <button 
                      className={`at-dropdown-item ${activeCase.status === 'PENDING' ? 'active' : ''}`}
                      onClick={() => handleStatusChange('PENDING')}
                    >
                      <div className="at-status-dot pending"></div> Pendiente de revisión
                    </button>
                    <button 
                      className={`at-dropdown-item ${activeCase.status === 'IN_PROGRESS' ? 'active' : ''}`}
                      onClick={() => handleStatusChange('IN_PROGRESS')}
                    >
                      <div className="at-status-dot in-progress"></div> En reparación
                    </button>
                    <button 
                      className={`at-dropdown-item ${activeCase.status === 'CANCELLED' ? 'active' : ''}`}
                      onClick={() => handleStatusChange('CANCELLED')}
                    >
                      <div className="at-status-dot cancelled"></div> Cancelado
                    </button>
                  </div>
                )}
              </div>

              <button 
                className="at-btn-green" 
                style={{ background: '#22c55e', color: 'white', border: 'none' }}
                onClick={handleOpenCompleteModal}
                disabled={updating}
              >
                <FiCheckCircle /> Finalizar caso
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="at-right-col">
          <div className="at-side-card">
            <h3 className="at-card-title">Información del equipo</h3>
            <div className="at-side-header">
              <div className="at-server-icon"><FiServer size={24} /></div>
              <div className="at-info-list">
                <div className="at-info-row">
                  <span className="at-info-label">Elemento</span>
                  <span className="at-info-value">{activeCase.item_name}</span>
                </div>
                <div className="at-info-row">
                  <span className="at-info-label">Código</span>
                  <span className="at-info-value">{activeCase.item_code || 'N/A'}</span>
                </div>
                <div className="at-info-row">
                  <span className="at-info-label">ID Sistema</span>
                  <span className="at-info-value">#{activeCase.item_id}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="at-side-card">
            <h3 className="at-card-title">Categoría</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--admin-text-muted)', fontSize: '0.85rem' }}>
              <FiBox /> {activeCase.item_category || 'General'}
            </div>
          </div>

          <div className="at-side-card">
            <h3 className="at-card-title">Reportado por</h3>
            <div className="at-user-row">
              <div className="at-user-avatar">
                <FiUser size={20} />
              </div>
              <div className="at-user-details">
                <h4>{activeCase.reported_by_name}</h4>
                <p>{activeCase.reported_by_email}</p>
                <p style={{ marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FiPhone size={12} /> Contacto no registrado
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* HISTORY TABLE */}
      <div className="at-section" style={{ marginTop: '2.5rem', background: 'var(--admin-bg-card, #0f172a)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--admin-border-color, rgba(255,255,255,0.08))' }}>
        <h3 className="at-card-title" style={{ marginBottom: '1.5rem' }}>Historial de Mantenimientos Completados</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--admin-border-color, rgba(255,255,255,0.08))', color: 'var(--admin-text-muted, #94a3b8)' }}>
                <th style={{ padding: '0.75rem 1rem' }}>ID</th>
                <th style={{ padding: '0.75rem 1rem' }}>Equipo</th>
                <th style={{ padding: '0.75rem 1rem' }}>Soporte (Técnico)</th>
                <th style={{ padding: '0.75rem 1rem' }}>Estado y Solución</th>
                <th style={{ padding: '0.75rem 1rem' }}>Fecha Reporte</th>
                <th style={{ padding: '0.75rem 1rem' }}>Adjunto</th>
              </tr>
            </thead>
            <tbody>
              {allCases.filter(c => c.status === 'COMPLETED' || c.status === 'CANCELLED').length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--admin-text-muted)' }}>No hay mantenimientos en el historial.</td></tr>
              ) : allCases.filter(c => c.status === 'COMPLETED' || c.status === 'CANCELLED').map(mCase => (
                <tr key={mCase.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'var(--admin-text-primary)' }}>
                  <td style={{ padding: '1rem' }}><span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontWeight: 'bold' }}>#{mCase.id}</span></td>
                  <td style={{ padding: '1rem' }}>
                    <strong>{mCase.item_name}</strong>
                    <div style={{ color: 'var(--admin-text-muted)', fontSize: '0.75rem', marginTop: '0.25rem' }}>Cód: {mCase.item_code}</div>
                  </td>
                  <td style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <FiUser /> {mCase.technician_name || 'N/A'}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ color: mCase.status === 'COMPLETED' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                      {mCase.status === 'COMPLETED' ? 'Completado' : 'Cancelado'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {new Date(mCase.report_date).toLocaleDateString()}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {mCase.evidence_photo ? (
                      <img 
                        src={mCase.evidence_photo} 
                        alt="Evidencia" 
                        title="Ver evidencia"
                        onClick={() => window.open(mCase.evidence_photo, '_blank')}
                        style={{ cursor: 'pointer', width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)' }}
                      />
                    ) : (
                      <span style={{ color: 'var(--admin-text-muted)', fontSize: '0.8rem' }}>Sin foto</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* CUSTOM FLOATING BACKDROP BLUR MODAL */}
      {showCompleteModal && (
        <div className="at-modal-overlay">
          <div className="at-modal-card">
            <div className="at-modal-header">
              <h2>Finalizar Caso Técnico</h2>
              <button className="at-modal-close" onClick={() => setShowCompleteModal(false)}>&times;</button>
            </div>
            
            <form onSubmit={handleCompleteSubmit} className="at-modal-form">
              <div className="at-form-group">
                <label>Diagnóstico Final del Equipo</label>
                <textarea 
                  required
                  placeholder="Describe detalladamente el diagnóstico y estado en que encontraste el equipo..."
                  value={diagnosis}
                  onChange={e => setDiagnosis(e.target.value)}
                  className="at-modal-textarea"
                />
              </div>
              
              <div className="at-form-group">
                <label>Procedimiento o Solución Realizada</label>
                <textarea 
                  required
                  placeholder="Detalla las acciones o pasos ejecutados para solucionar la falla..."
                  value={solution}
                  onChange={e => setSolution(e.target.value)}
                  className="at-modal-textarea"
                />
              </div>

              <div className="at-form-group">
                <label>Evidencia Fotográfica (Opcional)</label>
                <input 
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="at-modal-input"
                />
              </div>
              
              <div className="at-form-group">
                <label>Costo total de la reparación (COP)</label>
                <input 
                  type="number"
                  min="0"
                  required
                  placeholder="0"
                  value={cost}
                  onChange={e => setCost(e.target.value)}
                  className="at-modal-input"
                />
              </div>
              
              <div className="at-modal-actions">
                <button 
                  type="button" 
                  className="at-btn-cancel" 
                  onClick={() => setShowCompleteModal(false)}
                  disabled={updating}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="at-btn-submit"
                  disabled={updating}
                >
                  {updating ? 'Procesando...' : 'Finalizar Caso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
