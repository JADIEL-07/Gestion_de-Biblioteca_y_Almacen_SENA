import React, { useState, useEffect } from 'react';
import { FiClock, FiUser, FiPackage, FiFilter, FiSearch, FiCalendar, FiAlertTriangle, FiEye, FiX, FiCheckCircle } from 'react-icons/fi';
import { CustomSelect } from './CustomSelect';
import { confirmDialog, alertDialog } from '../../../../components/ui/ConfirmDialog';
import './LoanManagement.css';

interface LoanItem {
  id: number;
  name: string;
  category: string;
  nit: string | null;
  delivery_status: string;
  return_status: string | null;
}

interface Loan {
  id: number;
  user_id: string;
  user_name: string;
  user_email: string;
  user_phone: string;
  admin_name: string;
  loan_date: string;
  due_date: string;
  return_date: string | null;
  status: 'ACTIVE' | 'RETURNED' | 'OVERDUE' | 'NOT_RETURNED';
  fine_amount: number;
  sanction_type: 'DAYS' | 'CUSTOM' | null;
  sanction_days: number | null;
  sanction_description: string | null;
  sanction_active: boolean;
  sanction_created_at: string | null;
  sanction_lifted_at: string | null;
  items: LoanItem[];
}

export const LoanManagement: React.FC = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Panel para marcar un préstamo como no devuelto + imponer la sanción
  const [notReturnedLoan, setNotReturnedLoan] = useState<Loan | null>(null);
  const [sanctionType, setSanctionType] = useState<'DAYS' | 'CUSTOM'>('DAYS');
  const [sanctionDays, setSanctionDays] = useState('7');
  const [sanctionDescription, setSanctionDescription] = useState('');
  const [submittingSanction, setSubmittingSanction] = useState(false);

  // Panel de detalle de una sanción (ver descripción / levantarla)
  const [sanctionPanelLoan, setSanctionPanelLoan] = useState<Loan | null>(null);
  const [liftingSanction, setLiftingSanction] = useState(false);

  // Extraer todas las categorías únicas presentes en los préstamos
  const categories = Array.from(new Set(loans.flatMap(l => l.items.map(i => i.category))));

  const fetchLoans = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        search: searchTerm,
        startDate: startDate,
        endDate: endDate,
        category: filterCategory
      });
      const response = await fetch(`/api/v1/loans/?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setLoans(data);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLoans();
  }, [searchTerm, filterCategory, startDate, endDate]);

  const openNotReturnedModal = (loan: Loan) => {
    setNotReturnedLoan(loan);
    setSanctionType('DAYS');
    setSanctionDays('7');
    setSanctionDescription('');
  };

  const submitNotReturned = async () => {
    if (!notReturnedLoan) return;
    if (sanctionType === 'DAYS') {
      const n = parseInt(sanctionDays, 10);
      if (!n || n <= 0) {
        alertDialog('Ingresa un número de días válido.');
        return;
      }
    } else if (!sanctionDescription.trim()) {
      alertDialog('Escribe una descripción para la sanción.');
      return;
    }

    const ok = await confirmDialog({
      title: 'Marcar como no devuelto',
      message: `Se cerrará el préstamo #${notReturnedLoan.id} como NO DEVUELTO y ${notReturnedLoan.user_name} no podrá hacer nuevas reservas hasta que levantes la sanción. ¿Continuar?`,
      confirmText: 'Sí, aplicar sanción',
      danger: true,
    });
    if (!ok) return;

    setSubmittingSanction(true);
    try {
      const res = await fetch(`/api/v1/loans/${notReturnedLoan.id}/mark-not-returned`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          sanction_type: sanctionType,
          sanction_days: sanctionType === 'DAYS' ? parseInt(sanctionDays, 10) : undefined,
          sanction_description: sanctionDescription.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotReturnedLoan(null);
        fetchLoans();
      } else {
        alertDialog(data.error || 'No se pudo aplicar la sanción.');
      }
    } catch {
      alertDialog('Error de conexión al aplicar la sanción.');
    } finally {
      setSubmittingSanction(false);
    }
  };

  const handleLiftSanction = async (loan: Loan) => {
    const ok = await confirmDialog({
      message: `¿Levantar la sanción del préstamo #${loan.id}? ${loan.user_name} volverá a poder hacer reservas.`,
      confirmText: 'Sí, levantar sanción',
    });
    if (!ok) return;

    setLiftingSanction(true);
    try {
      const res = await fetch(`/api/v1/loans/${loan.id}/lift-sanction`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSanctionPanelLoan(null);
        fetchLoans();
      } else {
        alertDialog(data.error || 'No se pudo levantar la sanción.');
      }
    } catch {
      alertDialog('Error de conexión al levantar la sanción.');
    } finally {
      setLiftingSanction(false);
    }
  };

  const filteredLoans = loans.filter(loan => {
    const s = searchTerm.toLowerCase();
    const loanDate = new Date(loan.loan_date);
    
    // Filtro por texto (Usuario o ID)
    const matchesSearch = 
      loan.user_name.toLowerCase().includes(s) ||
      (loan.user_email?.toLowerCase() || '').includes(s) ||
      (loan.user_phone?.toLowerCase() || '').includes(s) ||
      loan.user_id.toLowerCase().includes(s) ||
      loan.id.toString().includes(searchTerm) ||
      loan.items.some(item => 
        item.name.toLowerCase().includes(s) || 
        (item.nit?.toLowerCase() || '').includes(s)
      );
    
    // Filtro por Categoría
    const matchesCategory = filterCategory === 'ALL' || 
      loan.items.some(item => item.category === filterCategory);
    
    // Filtro por Rango de Fechas
    const start = startDate ? new Date(startDate + 'T00:00:00') : null;
    const end = endDate ? new Date(endDate + 'T23:59:59') : null;
    
    let matchesDate = true;
    if (start && loanDate < start) matchesDate = false;
    if (end && loanDate > end) matchesDate = false;
    
    return matchesSearch && matchesCategory && matchesDate;
  });

  return (
    <div className="loan-mgmt-container fade-in">
      <div className="loan-mgmt-header">
        <div className="header-title">
          <div className="header-icon-box"><FiClock /></div>
          <div>
            <h1>Historial de Préstamos</h1>
          </div>
        </div>
      </div>

      <div className="loan-filters-complex">
        <div className="filter-row">
          <div className="filter-item search">
            <label>Búsqueda Rápida</label>
            <div className="input-with-icon">
              <FiSearch />
              <input 
                type="text" 
                placeholder="Nombre o ID..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          <div className="filter-item">
            <CustomSelect 
              label="Categoría del Elemento"
              options={[{ id: 'ALL', name: 'Todas las categorías' }, ...categories.map(cat => ({ id: cat, name: cat }))]}
              value={filterCategory}
              onChange={setFilterCategory}
              icon={<FiPackage />}
            />
          </div>
        </div>

        <div className="filter-row">
          <div className="filter-item">
            <label>Desde (Fecha)</label>
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
            <label>Hasta (Fecha)</label>
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

      <div className="loan-table-wrapper">
        <table className="loan-table">
          <thead>
            <tr>
              <th className="col-center">ID</th>
              <th>Responsable</th>
              <th>Aprendiz (Recibe)</th>
              <th>Elemento / Categoría</th>
              <th className="col-center">F. Préstamo</th>
              <th className="col-center">Entrega Real</th>
              <th className="col-center">Plazo</th>
              <th className="col-center">Estado</th>
              <th className="col-center">Multa</th>
              <th className="col-center">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="td-center">Cargando...</td></tr>
            ) : filteredLoans.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <div className="empty-state-container" style={{ padding: '5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', color: 'var(--admin-text-muted)' }}>
                    <FiClock size={48} style={{ opacity: 0.2 }} />
                    <p>No se encontraron registros de préstamos con los filtros aplicados.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLoans.map(loan => (
                <tr key={loan.id}>
                  <td className="col-center"><span className="id-badge">#{loan.id}</span></td>
                  <td>
                    <div className="user-cell">
                      <FiUser className="cell-icon" />
                      <div className="cell-text-stack">
                        <span className="main-text">{loan.admin_name}</span>
                        <span className="sub-text">ADMIN</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="user-cell">
                      <FiUser className="cell-icon" />
                      <div className="cell-text-stack">
                        <span className="main-text">{loan.user_name}</span>
                        <span className="sub-text">{loan.user_id}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {loan.items.map(item => (
                      <div key={item.id} className="item-cell-content">
                        <FiPackage className="cell-icon" />
                        <div className="cell-text-stack">
                          <span className="main-text">{item.name}</span>
                          <span className="sub-text">
                            ID: <strong>#{item.id}</strong> | CAT: {item.category}
                            {item.nit && ` | NIT: ${item.nit}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </td>
                  <td className="date-text col-center">{new Date(loan.loan_date).toLocaleDateString()}<br/>{new Date(loan.loan_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td className="date-text col-center">
                    {loan.return_date ? (
                      <>{new Date(loan.return_date).toLocaleDateString()}<br/>{new Date(loan.return_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</>
                    ) : <span style={{opacity: 0.4}}>Pendiente</span>}
                  </td>
                  <td className="col-center">7 días</td>
                  <td className="col-center">
                    <span className={`status-pill ${loan.status.toLowerCase()}`}>
                      {loan.status === 'ACTIVE' ? 'ACTIVO'
                        : loan.status === 'RETURNED' ? 'DEVUELTO'
                        : loan.status === 'NOT_RETURNED' ? 'NO DEVUELTO'
                        : 'VENCIDO'}
                    </span>
                  </td>
                  <td className="col-center">
                    {loan.status === 'NOT_RETURNED' ? (
                      <button
                        className={`fine-badge-btn ${loan.sanction_active ? 'sanction-active' : 'sanction-lifted'}`}
                        onClick={() => setSanctionPanelLoan(loan)}
                        title="Ver detalle de la sanción"
                      >
                        {loan.sanction_active ? <FiAlertTriangle size={12} /> : <FiCheckCircle size={12} />}
                        {loan.sanction_active ? 'Sí aplica' : 'Levantada'}
                      </button>
                    ) : (
                      <span className={`fine-badge ${loan.fine_amount > 0 ? 'has-fine' : ''}`}>
                        {loan.fine_amount > 0 ? `$${loan.fine_amount.toLocaleString()}` : 'No aplica'}
                      </span>
                    )}
                  </td>
                  <td className="col-center">
                    {(loan.status === 'ACTIVE' || loan.status === 'OVERDUE') ? (
                      <button
                        className="btn-mark-not-returned"
                        onClick={() => openNotReturnedModal(loan)}
                        title="El aprendiz nunca devolvió este elemento"
                      >
                        <FiAlertTriangle size={12} /> No devuelto
                      </button>
                    ) : (
                      <span className="sub-text">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* PANEL: marcar como no devuelto + imponer sanción */}
      {notReturnedLoan && (
        <div className="loan-modal-overlay" onClick={() => setNotReturnedLoan(null)}>
          <div className="loan-modal-content" onClick={e => e.stopPropagation()}>
            <div className="loan-modal-header">
              <h3><FiAlertTriangle /> Marcar préstamo #{notReturnedLoan.id} como no devuelto</h3>
              <button className="btn-close-loan-modal" onClick={() => setNotReturnedLoan(null)}><FiX /></button>
            </div>
            <div className="loan-modal-body">
              <p className="loan-modal-hint">
                <strong>{notReturnedLoan.user_name}</strong> no devolvió {notReturnedLoan.items.length > 1 ? 'los elementos' : 'el elemento'} de este préstamo.
                Esto lo bloqueará para hacer nuevas reservas hasta que levantes la sanción.
              </p>

              <label className="loan-form-label">Tipo de sanción</label>
              <div className="sanction-type-toggle">
                <button
                  type="button"
                  className={sanctionType === 'DAYS' ? 'active' : ''}
                  onClick={() => setSanctionType('DAYS')}
                >
                  Sanción por días
                </button>
                <button
                  type="button"
                  className={sanctionType === 'CUSTOM' ? 'active' : ''}
                  onClick={() => setSanctionType('CUSTOM')}
                >
                  Otra sanción
                </button>
              </div>

              {sanctionType === 'DAYS' ? (
                <>
                  <label className="loan-form-label">Días de suspensión de reservas</label>
                  <input
                    type="number"
                    min={1}
                    className="loan-form-input"
                    value={sanctionDays}
                    onChange={e => setSanctionDays(e.target.value)}
                  />
                  <label className="loan-form-label">Nota adicional (opcional)</label>
                  <textarea
                    className="loan-form-textarea"
                    rows={2}
                    placeholder="Ej: el aprendiz no respondió a los recordatorios..."
                    value={sanctionDescription}
                    onChange={e => setSanctionDescription(e.target.value)}
                  />
                </>
              ) : (
                <>
                  <label className="loan-form-label">Describe la sanción</label>
                  <textarea
                    className="loan-form-textarea"
                    rows={4}
                    placeholder="Ej: se retiene el carné hasta que reponga el elemento..."
                    value={sanctionDescription}
                    onChange={e => setSanctionDescription(e.target.value)}
                  />
                </>
              )}
            </div>
            <div className="loan-modal-footer">
              <button className="btn-loan-secondary" onClick={() => setNotReturnedLoan(null)} disabled={submittingSanction}>
                Cancelar
              </button>
              <button className="btn-loan-danger" onClick={submitNotReturned} disabled={submittingSanction}>
                {submittingSanction ? 'Aplicando...' : 'Aplicar sanción'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PANEL: detalle de la sanción / levantarla */}
      {sanctionPanelLoan && (
        <div className="loan-modal-overlay" onClick={() => setSanctionPanelLoan(null)}>
          <div className="loan-modal-content mini" onClick={e => e.stopPropagation()}>
            <div className="loan-modal-header">
              <h3><FiAlertTriangle /> Sanción — Préstamo #{sanctionPanelLoan.id}</h3>
              <button className="btn-close-loan-modal" onClick={() => setSanctionPanelLoan(null)}><FiX /></button>
            </div>
            <div className="loan-modal-body">
              <div className="sanction-detail-row">
                <label>Aprendiz</label>
                <span>{sanctionPanelLoan.user_name}</span>
              </div>
              <div className="sanction-detail-row">
                <label>Tipo</label>
                <span>{sanctionPanelLoan.sanction_type === 'DAYS' ? `${sanctionPanelLoan.sanction_days} día(s) de suspensión` : 'Sanción personalizada'}</span>
              </div>
              <div className="sanction-detail-row">
                <label>Descripción</label>
                <p>{sanctionPanelLoan.sanction_description || 'Sin descripción.'}</p>
              </div>
              <div className="sanction-detail-row">
                <label>Impuesta</label>
                <span>{sanctionPanelLoan.sanction_created_at ? new Date(sanctionPanelLoan.sanction_created_at).toLocaleString() : '—'}</span>
              </div>
              {!sanctionPanelLoan.sanction_active && (
                <div className="sanction-lifted-note">
                  <FiCheckCircle /> Sanción levantada{sanctionPanelLoan.sanction_lifted_at ? ` el ${new Date(sanctionPanelLoan.sanction_lifted_at).toLocaleString()}` : ''}. El aprendiz ya puede reservar.
                </div>
              )}
            </div>
            {sanctionPanelLoan.sanction_active && (
              <div className="loan-modal-footer">
                <button className="btn-loan-secondary" onClick={() => setSanctionPanelLoan(null)} disabled={liftingSanction}>
                  Cerrar
                </button>
                <button className="btn-loan-primary" onClick={() => handleLiftSanction(sanctionPanelLoan)} disabled={liftingSanction}>
                  {liftingSanction ? 'Levantando...' : 'Levantar sanción'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
