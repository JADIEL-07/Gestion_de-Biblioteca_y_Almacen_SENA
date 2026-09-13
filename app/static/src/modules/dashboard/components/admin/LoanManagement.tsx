import React, { useState, useEffect } from 'react';
import { FiClock, FiUser, FiPackage, FiFilter, FiSearch, FiCalendar } from 'react-icons/fi';
import { CustomSelect } from './CustomSelect';
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
  status: 'ACTIVE' | 'RETURNED' | 'OVERDUE';
  fine_amount: number;
  items: LoanItem[];
}

export const LoanManagement: React.FC = () => {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
              <th>ID</th>
              <th>Responsable</th>
              <th>Aprendiz (Recibe)</th>
              <th>Elemento / Categoría</th>
              <th>F. Préstamo</th>
              <th>Entrega Real</th>
              <th>Plazo</th>
              <th>Estado</th>
              <th>Multa</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="td-center">Cargando...</td></tr>
            ) : filteredLoans.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="empty-state-container" style={{ padding: '5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', color: 'var(--admin-text-muted)' }}>
                    <FiClock size={48} style={{ opacity: 0.2 }} />
                    <p>No se encontraron registros de préstamos con los filtros aplicados.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredLoans.map(loan => (
                <tr key={loan.id}>
                  <td><span className="id-badge">#{loan.id}</span></td>
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
                  <td className="date-text">{new Date(loan.loan_date).toLocaleDateString()}<br/>{new Date(loan.loan_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td className="date-text">
                    {loan.return_date ? (
                      <>{new Date(loan.return_date).toLocaleDateString()}<br/>{new Date(loan.return_date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</>
                    ) : <span style={{opacity: 0.4}}>Pendiente</span>}
                  </td>
                  <td>7 días</td>
                  <td>
                    <span className={`status-pill ${loan.status.toLowerCase()}`}>
                      {loan.status === 'ACTIVE' ? 'ACTIVO' : loan.status === 'RETURNED' ? 'DEVUELTO' : 'VENCIDO'}
                    </span>
                  </td>
                  <td>
                    <span className={`fine-badge ${loan.fine_amount > 0 ? 'has-fine' : ''}`}>
                      {loan.fine_amount > 0 ? `$${loan.fine_amount.toLocaleString()}` : 'No aplica'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
