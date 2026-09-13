import React, { useState, useEffect, useMemo } from 'react';
import { FiGrid, FiClock, FiAlertCircle, FiArchive, FiInfo, FiPackage } from 'react-icons/fi';
import './AprendizLoans.css';

interface LoanItem {
  id: number; // item id
  name: string;
  code: string;
  category: string;
  image_url: string | null;
}

interface Loan {
  id: number;
  loan_date: string;
  due_date: string;
  return_date: string | null;
  status: 'ACTIVE' | 'RETURNED' | 'OVERDUE' | 'CANCELLED';
  fine_amount: number;
  items: LoanItem[];
}

interface FlattenedLoanItem {
  loan_id: number;
  item: LoanItem;
  loan_date: string;
  due_date: string;
  status: 'ACTIVE' | 'RETURNED' | 'OVERDUE' | 'CANCELLED';
}

const getStatusConfig = (status: string, dueDate: string) => {
  if (status === 'RETURNED') return { text: 'Devuelto', type: 'default', sub: 'Entregado' };
  
  const ms = new Date(dueDate).getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  
  if (status === 'OVERDUE' || days < 0) {
    return { text: 'Atrasado', type: 'danger', sub: `Hace ${Math.abs(days)} días` };
  }
  if (days <= 3) {
    return { text: 'Por vencer', type: 'warning', sub: `En ${days} día${days > 1 ? 's' : ''}` };
  }
  return { text: 'Activo', type: 'success', sub: 'En buen estado' };
};

const formatDateObj = (iso: string) => {
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  return { dateStr, timeStr };
};

export const AprendizLoans: React.FC = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'activos' | 'devueltos'>('activos');

  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedItemForReport, setSelectedItemForReport] = useState<FlattenedLoanItem | null>(null);
  const [reportDescription, setReportDescription] = useState('');
  const [reportSeverity, setReportSeverity] = useState('MEDIUM');
  const [reportPhoto, setReportPhoto] = useState<string | null>(null);
  const [submittingReport, setSubmittingReport] = useState(false);

  const handleOpenReportModal = (item: FlattenedLoanItem) => {
    setSelectedItemForReport(item);
    setReportDescription('');
    setReportSeverity('MEDIUM');
    setReportPhoto(null);
    setShowReportModal(true);
  };

  const handleCloseReportModal = () => {
    setShowReportModal(false);
    setSelectedItemForReport(null);
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setReportPhoto(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemForReport || !reportDescription.trim()) return;

    setSubmittingReport(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/reports_mgmt/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subject: `Incidencia: ${selectedItemForReport.item.name} (${selectedItemForReport.item.code})`,
          description: reportDescription,
          severity: reportSeverity,
          photo: reportPhoto
        })
      });

      if (response.ok) {
        alert("Reporte de incidencia creado con éxito.");
        handleCloseReportModal();
      } else {
        const err = await response.json();
        alert(err.error || "Error al crear el reporte.");
      }
    } catch (error) {
      console.error("Error submitting report:", error);
      alert("Error de conexión al enviar el reporte.");
    } finally {
      setSubmittingReport(false);
    }
  };

  useEffect(() => {
    const fetchLoans = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch('/api/v1/loans/my', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          setLoans(await response.json());
        }
      } catch (error) {
        console.error("Error fetching my loans:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchLoans();
  }, []);

  const flattenedItems = useMemo(() => {
    const items: FlattenedLoanItem[] = [];
    loans.forEach(loan => {
      loan.items.forEach(item => {
        items.push({
          loan_id: loan.id,
          item,
          loan_date: loan.loan_date,
          due_date: loan.due_date,
          status: loan.status
        });
      });
    });
    return items;
  }, [loans]);

  const activeItems = flattenedItems.filter(i => i.status === 'ACTIVE' || i.status === 'OVERDUE');
  const returnedItems = flattenedItems.filter(i => i.status === 'RETURNED');
  
  const displayedItems = activeTab === 'activos' ? activeItems : returnedItems;

  const stats = useMemo(() => {
    let active = 0;
    let nearDue = 0;
    let overdue = 0;
    
    activeItems.forEach(i => {
      active++;
      const ms = new Date(i.due_date).getTime() - Date.now();
      const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
      if (days < 0 || i.status === 'OVERDUE') overdue++;
      else if (days <= 3) nearDue++;
    });

    return {
      active,
      nearDue,
      overdue,
      total: loans.length // Total loans, not items
    };
  }, [activeItems, loans.length]);

  return (
    <div className="loans-container fade-in">
      <div className="loans-header-section">
        <h1>Mis préstamos</h1>
        <p>Revisa los elementos que tienes en préstamo.</p>
        
        {/* SUMMARY CARDS */}
        <div className="loans-summary-grid">
          <div className="loan-stat-card">
            <div className="stat-icon-wrapper success">
              <FiGrid size={22} />
            </div>
            <div className="stat-content">
              <h5>Préstamos activos</h5>
              <h3>{stats.active}</h3>
              <p>Elementos en tu poder</p>
            </div>
          </div>
          
          <div className="loan-stat-card">
            <div className="stat-icon-wrapper warning">
              <FiClock size={22} />
            </div>
            <div className="stat-content">
              <h5>Por vencer</h5>
              <h3>{stats.nearDue}</h3>
              <p>En los próximos 3 días</p>
            </div>
          </div>
          
          <div className="loan-stat-card">
            <div className="stat-icon-wrapper danger">
              <FiAlertCircle size={22} />
            </div>
            <div className="stat-content">
              <h5>Atrasados</h5>
              <h3>{stats.overdue}</h3>
              <p>{stats.overdue > 0 ? 'Con retraso' : 'Sin retrasos'}</p>
            </div>
          </div>
          
          <div className="loan-stat-card">
            <div className="stat-icon-wrapper primary">
              <FiArchive size={22} />
            </div>
            <div className="stat-content">
              <h5>Historial total</h5>
              <h3>{stats.total}</h3>
              <p>Préstamos realizados</p>
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="loans-tabs">
          <button 
            className={`loans-tab-btn ${activeTab === 'activos' ? 'active' : ''}`}
            onClick={() => setActiveTab('activos')}
          >
            Activos
          </button>
          <button 
            className={`loans-tab-btn ${activeTab === 'devueltos' ? 'active' : ''}`}
            onClick={() => setActiveTab('devueltos')}
          >
            Devueltos
          </button>
        </div>
      </div>

      {loading ? (
        <div className="loading-spinner-container">
          <div className="spinner"></div>
          <p>Cargando préstamos...</p>
        </div>
      ) : displayedItems.length === 0 ? (
        <div className="loans-empty-state">
          <FiGrid size={48} />
          <p>No tienes elementos en esta categoría.</p>
        </div>
      ) : (
        <div className="loans-table-wrapper">
          <table className="loans-table">
            <thead>
              <tr>
                <th>Elemento</th>
                <th>Código</th>
                <th>Fecha préstamo</th>
                <th>Fecha límite</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {displayedItems.map((fi, index) => {
                const conf = getStatusConfig(fi.status, fi.due_date);
                const lDate = formatDateObj(fi.loan_date);
                const dDate = formatDateObj(fi.due_date);
                
                return (
                  <tr key={`${fi.loan_id}-${fi.item.id}-${index}`}>
                    <td className="item-col">
                      <div className="item-cell-content">
                        <div className="item-mini-img">
                          {fi.item.image_url ? (
                            <img src={fi.item.image_url} alt={fi.item.name} />
                          ) : (
                            <FiPackage size={20} />
                          )}
                        </div>
                        <div className="item-titles">
                          <span className="item-name">{fi.item.name}</span>
                          <span className="item-cat">{fi.item.category}</span>
                        </div>
                      </div>
                    </td>
                    <td>{fi.item.code}</td>
                    <td>
                      <div className="date-cell">
                        <span className="date-str">{lDate.dateStr}</span>
                        <span className="time-str">{lDate.timeStr}</span>
                      </div>
                    </td>
                    <td>
                      <div className="date-cell">
                        <span className="date-str">{dDate.dateStr}</span>
                        <span className="time-str">{dDate.timeStr}</span>
                      </div>
                    </td>
                    <td>
                      <div className="status-cell">
                        <span className={`status-text ${conf.type}`}>{conf.text}</span>
                        <span className="status-sub">{conf.sub}</span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <button className="btn-outline">Ver detalle</button>
                        {(fi.status === 'ACTIVE' || fi.status === 'OVERDUE') && (
                          <button 
                            className="btn-outline" 
                            style={{ borderColor: '#ef4444', color: '#ef4444' }}
                            onClick={() => handleOpenReportModal(fi)}
                          >
                            Reportar Daño
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* RENEWAL BANNER */}
      {activeTab === 'activos' && activeItems.length > 0 && (
        <div className="renewal-banner">
          <div className="renewal-icon">
            <FiInfo size={24} />
          </div>
          <div className="renewal-content">
            <h4>¿Necesitas más tiempo?</h4>
            <p>Puedes solicitar una renovación si el elemento no ha sido reservado por otra persona.</p>
          </div>
          <button className="btn-renewal">Solicitar renovación</button>
        </div>
      )}

      {/* GLASSMORPHISM BLUR-BACKDROP MODAL */}
      {showReportModal && selectedItemForReport && (
        <div className="report-modal-overlay" onClick={handleCloseReportModal}>
          <div className="report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="report-modal-header">
              <h3>Reportar Incidencia / Daño</h3>
              <button className="btn-close-modal" onClick={handleCloseReportModal}>&times;</button>
            </div>
            <form onSubmit={handleReportSubmit}>
              <div className="report-modal-body">
                <div style={{ marginBottom: '1rem', background: '#0f172a', padding: '0.8rem', borderRadius: '8px', border: '1px solid #334155' }}>
                  <span style={{ fontSize: '0.75rem', color: '#94a3b8', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Elemento en Reporte</span>
                  <strong style={{ fontSize: '1rem', color: '#ffffff', marginTop: '0.2rem', display: 'block' }}>{selectedItemForReport.item.name}</strong>
                  <span style={{ fontSize: '0.8rem', color: '#39A900', marginTop: '0.1rem', display: 'block' }}>Código: {selectedItemForReport.item.code}</span>
                </div>

                <div className="report-form-group">
                  <label htmlFor="report-desc">Descripción del Problema</label>
                  <textarea
                    id="report-desc"
                    className="report-form-control"
                    rows={4}
                    placeholder="Describe en detalle el problema o daño presentado en el elemento..."
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    required
                  ></textarea>
                </div>

                <div className="report-form-group">
                  <label htmlFor="report-sev">Gravedad de la Incidencia</label>
                  <select
                    id="report-sev"
                    className="report-form-control"
                    value={reportSeverity}
                    onChange={(e) => setReportSeverity(e.target.value)}
                  >
                    <option value="LOW">Baja (Funcionamiento parcial, daño estético)</option>
                    <option value="MEDIUM">Media (Falla intermitente, requiere revisión)</option>
                    <option value="HIGH">Alta (Inoperable, requiere reparación urgente)</option>
                    <option value="CRITICAL">Crítica (Riesgo físico, daño catastrófico)</option>
                  </select>
                </div>

                <div className="report-form-group">
                  <label>Adjuntar Evidencia Fotográfica</label>
                  {!reportPhoto ? (
                    <div className="report-file-upload">
                      <input type="file" accept="image/*" onChange={handlePhotoChange} />
                      <div className="upload-icon">📷</div>
                      <span className="upload-text">Haz clic o arrastra una imagen aquí</span>
                      <span className="upload-hint">Formatos soportados: JPG, PNG, WEBP</span>
                    </div>
                  ) : (
                    <div className="photo-preview-container">
                      <img src={reportPhoto} alt="Evidencia de daño" />
                      <button type="button" className="btn-remove-photo" onClick={() => setReportPhoto(null)}>&times;</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="report-modal-footer">
                <button type="button" className="btn-report-cancel" onClick={handleCloseReportModal} disabled={submittingReport}>
                  Cancelar
                </button>
                <button type="submit" className="btn-report-submit" disabled={submittingReport || !reportDescription.trim()}>
                  {submittingReport ? "Enviando..." : "Enviar Reporte"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
